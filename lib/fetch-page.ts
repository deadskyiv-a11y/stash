import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    p[0] >= 224
  );
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Refuses anything that is not a public http(s) address, so a saved link can never reach internal systems. */
async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only web links can be saved");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Address not allowed");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => privateIp(a.address))) throw new Error("Address not allowed");
}

async function safeFetch(input: string, accept: string, maxBytes: number): Promise<{ res: Response; body: Buffer; finalUrl: string }> {
  let url = new URL(input);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
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
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { await reader.cancel(); break; }
        chunks.push(value);
      }
    }
    return { res, body: Buffer.concat(chunks), finalUrl: url.toString() };
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
      if (await fetch(big, { method: "HEAD", signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false)) imageUrl = big;
    }
    const by = j.author_name ? `By ${j.author_name}` : null;
    // Instagram's "title" is the whole caption. Keep its first line as the title and the rest as text.
    const caption: string = typeof j.title === "string" ? j.title : "";
    const title = caption.split("\n")[0].slice(0, 120) || null;
    return { url: input, site: hit[1], title, description: by, imageUrl, text: [caption, by].filter(Boolean).join(". ") };
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

export async function fetchPage(input: string): Promise<Page> {
  const embedded = (await fromOembed(input)) || (await fromOmdb(input));
  if (embedded) return embedded;
  const { res, body, finalUrl } = await safeFetch(input, "text/html,application/xhtml+xml", 2_000_000);
  const u = new URL(finalUrl);
  const site = u.hostname.replace(/^www\./, "");
  const type = res.headers.get("content-type") || "";
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
    imageUrl: image ? new URL(image, u).toString() : null,
    text,
  };
}

export async function fetchImage(input: string): Promise<Buffer | null> {
  try {
    const { res, body } = await safeFetch(input, "image/*", 8_000_000);
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/") || body.length === 0) return null;
    return body;
  } catch {
    return null;
  }
}
