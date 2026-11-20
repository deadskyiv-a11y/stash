import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as guardedFetch } from "undici";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  return (
    p.length !== 4 || p.some((n) => !Number.isInteger(n)) ||
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    p[0] >= 224
  );
}

/**
 * True for any address a saved link must never reach: loopback, private ranges, link-local, and every
 * IPv6 form that can carry an IPv4 address inside it. Anything not recognised as a plain public address is refused.
 */
export function privateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind !== 6) return true;
  const v = ip.toLowerCase();
  return (
    v.startsWith("::") ||                 // loopback, unspecified, IPv4-mapped (::ffff:...) and IPv4-compatible
    v.startsWith("fc") || v.startsWith("fd") || // unique local
    /^fe[89ab]/.test(v) ||                // link-local, fe80::/10
    v.startsWith("64:ff9b:") ||           // NAT64, carries an IPv4 address
    v.startsWith("2002:") ||              // 6to4, carries an IPv4 address
    v.startsWith("ff")                    // multicast
  );
}

/**
 * Every outbound request for a saved link goes through this agent. It checks the address at the moment of
 * connecting, so a name that answers "public" to one lookup and "internal" to the next cannot slip past.
 */
const guard = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, found) => {
        const list = (found || []) as LookupAddress[];
        if (err) return callback(err, "", 4);
        if (list.length === 0 || list.some((a) => privateIp(a.address))) return callback(new Error("Address not allowed"), "", 4);
        if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
        else callback(null, list[0].address, list[0].family);
      });
    },
  },
});

/** Refuses anything that is not a plain public http(s) address, before any connection is attempted. */
function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only web links can be saved");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Address not allowed");
  // A saved link never needs a bare IPv6 address, and those have too many disguises. A bare IPv4 address is checked.
  if (isIP(host) === 6 || (isIP(host) === 4 && privateIp(host))) throw new Error("Address not allowed");
}

async function safeFetch(input: string, accept: string, maxBytes: number, method: "GET" | "HEAD" = "GET"): Promise<{ type: string; body: Buffer; finalUrl: string }> {
  let url = new URL(input);
  for (let hop = 0; hop < 5; hop++) {
    assertPublic(url);
    const res = await guardedFetch(url, {
      method,
      dispatcher: guard,
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`The page answered with ${res.status}`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader && method === "GET") {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        // Over the limit: refuse it. A cut-off page or picture is worse than none.
        if (size > maxBytes) { await reader.cancel(); throw new Error("That page or picture is too large"); }
        chunks.push(value);
      }
    }
    return { type: res.headers.get("content-type") || "", body: Buffer.concat(chunks), finalUrl: url.toString() };
  }
  throw new Error("Too many redirects");
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();
}

function meta(html: string, names: string[]): string | null {
  for (const name of names) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i").exec(html);
    if (a) return decode(a[1]);
    const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i").exec(html);
    if (b) return decode(b[1]);
  }
  return null;
}

export type Page = {
  url: string;
  site: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  text: string;
};

// Big platforms hide the picture from servers but publish it on an official oEmbed address.
const OEMBED: [RegExp, string, string][] = [
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube", "https://www.youtube.com/oembed?format=json&url="],
  [/(^|\.)instagram\.com$/, "Instagram", "https://www.instagram.com/api/v1/oembed/?url="],
  [/(^|\.)vimeo\.com$/, "Vimeo", "https://vimeo.com/api/oembed.json?url="],
  [/(^|\.)spotify\.com$/, "Spotify", "https://open.spotify.com/oembed?url="],
];

/** Spotify's oEmbed names the album or song but not the artist. Its public embed page has the artist, year and tracks. */
async function spotifyDetails(u: URL): Promise<{ artist: string; lines: string[] } | null> {
  const m = /\/(album|track|playlist|episode|show)\/([A-Za-z0-9]+)/.exec(u.pathname);
  if (!m) return null;
  try {
    const { body } = await safeFetch(`https://open.spotify.com/embed/${m[1]}/${m[2]}`, "text/html", 500_000);
    const data = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(body.toString("utf8"));
    if (!data) return null;
    const e = JSON.parse(data[1])?.props?.pageProps?.state?.data?.entity;
    if (!e) return null;
    const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\u00a0/g, " ").trim() : "");
    const artist = clean(e.subtitle) || (Array.isArray(e.artists) ? e.artists.map((a: { name?: string }) => clean(a?.name)).filter(Boolean).join(", ") : "");
    const year = clean(e.releaseDate?.isoString).slice(0, 4);
    const tracks: string[] = Array.isArray(e.trackList) ? e.trackList.slice(0, 30).map((t: { title?: string; subtitle?: string }) => [clean(t?.title), clean(t?.subtitle)].filter(Boolean).join(" by ")).filter(Boolean) : [];
    return { artist, lines: [`Spotify ${m[1]}.`, year ? `Released ${year}.` : "", tracks.length ? `Tracks: ${tracks.join("; ")}` : ""].filter(Boolean) };
  } catch {
    return null;
  }
}

async function fromOembed(input: string): Promise<Page | null> {
  const u = new URL(input);
  const hit = OEMBED.find(([re]) => re.test(u.hostname));
  if (!hit) return null;
  try {
    const o = await safeFetch(hit[2] + encodeURIComponent(input), "application/json", 200_000);
    const j = JSON.parse(o.body.toString("utf8"));
    if (!j.thumbnail_url) return null;
    let imageUrl: string = j.thumbnail_url;
    if (hit[1] === "YouTube") {
      // The default YouTube thumbnail is letterboxed; the full-size one has no bars but not every video has it.
      const big = imageUrl.replace("hqdefault", "maxresdefault");
      if (await safeFetch(big, "image/*", 0, "HEAD").then(() => true, () => false)) imageUrl = big;
    }
    const spotify = hit[1] === "Spotify" ? await spotifyDetails(u) : null;
    const author = j.author_name || spotify?.artist;
    const by = author ? `By ${author}` : null;
    // Instagram's "title" is the whole caption. Keep its first line as the title and the rest as text.
    const caption: string = typeof j.title === "string" ? j.title : "";
    const title = caption.split("\n")[0].slice(0, 120) || null;
    return { url: input, site: hit[1], title, description: by, imageUrl, text: [caption, by, ...(spotify?.lines || [])].filter(Boolean).join(". ") };
  } catch {
    return null; // fall back to reading the page itself
  }
}

// IMDb puts a robot check in front of its pages. OMDb is a film database with a proper API that
// looks a film up by its IMDb number and returns the title, plot and poster.
async function fromOmdb(input: string): Promise<Page | null> {
  const key = process.env.OMDB_API_KEY;
  const u = new URL(input);
  const id = /(^|\.)imdb\.com$/.test(u.hostname) ? /\/title\/(tt\d+)/.exec(u.pathname)?.[1] : null;
  if (!key || !id) return null;
  try {
    const o = await safeFetch(`https://www.omdbapi.com/?i=${id}&plot=short&apikey=${encodeURIComponent(key)}`, "application/json", 200_000);
    const j = JSON.parse(o.body.toString("utf8"));
    if (j.Response !== "True" || !j.Title) return null;
    const has = (v: unknown): v is string => typeof v === "string" && v !== "" && v !== "N/A";
    const facts = [["Director", j.Director], ["Cast", j.Actors], ["Genre", j.Genre], ["Released", j.Released], ["Runtime", j.Runtime]]
      .filter(([, v]) => has(v)).map(([k, v]) => `${k}: ${v}`);
    return {
      url: `https://www.imdb.com/title/${id}/`,
      site: "IMDb",
      title: has(j.Year) ? `${j.Title} (${j.Year})` : j.Title,
      description: has(j.Plot) ? j.Plot : null,
      // The poster comes small by default; ask the same address for a larger one.
      imageUrl: has(j.Poster) ? j.Poster.replace(/_SX\d+/, "_SX900") : null,
      text: [has(j.Type) ? `A ${j.Type}.` : "", has(j.Plot) ? j.Plot : "", ...facts].filter(Boolean).join("\n"),
    };
  } catch {
    return null;
  }
}

/** A page's picture address made absolute. A malformed one is dropped, so it cannot spoil the rest of the page read. */
function pictureAddress(image: string | null, base: URL): string | null {
  if (!image) return null;
  try { return new URL(image, base).toString(); } catch { return null; }
}

export async function fetchPage(input: string): Promise<Page> {
  const embedded = (await fromOembed(input)) || (await fromOmdb(input));
  if (embedded) return embedded;
  const { type, body, finalUrl } = await safeFetch(input, "text/html,application/xhtml+xml", 2_000_000);
  const u = new URL(finalUrl);
  const site = u.hostname.replace(/^www\./, "");
  if (type.startsWith("image/")) {
    return { url: finalUrl, site, title: null, description: null, imageUrl: finalUrl, text: "" };
  }
  const html = body.toString("utf8");
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const image = meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).slice(0, 6000);
  return {
    url: finalUrl,
    site: meta(html, ["og:site_name"]) || site,
    title: meta(html, ["og:title", "twitter:title"]) || (titleTag ? decode(titleTag[1]) : null),
    description: meta(html, ["og:description", "description", "twitter:description"]),
    imageUrl: pictureAddress(image, u),
    text,
  };
}

export async function fetchImage(input: string): Promise<Buffer | null> {
  try {
    const { type, body } = await safeFetch(input, "image/*", 8_000_000);
    if (!type.startsWith("image/") || body.length === 0) return null;
    return body;
  } catch {
    return null;
  }
}
