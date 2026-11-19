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

export async function fetchPage(input: string): Promise<Page> {
  const { res, body, finalUrl } = await safeFetch(input, "text/html,application/xhtml+xml", 2_000_000);
  const u = new URL(finalUrl);
  const site = u.hostname.replace(/^www\./, "");
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("image/")) {
    return { url: finalUrl, site, title: null, description: null, imageUrl: finalUrl, text: "" };
  }
  // YouTube shows server visitors a bare page with no title or image; its oEmbed address has both.
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
    try {
      const o = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(finalUrl)}`, "application/json", 100_000);
      const j = JSON.parse(o.body.toString("utf8"));
      if (j.thumbnail_url) {
        // The default thumbnail is letterboxed; the full-size one has no bars but not every video has it.
        const big = j.thumbnail_url.replace("hqdefault", "maxresdefault");
        const ok = await fetch(big, { method: "HEAD", signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
        return { url: finalUrl, site: "YouTube", title: j.title || null, description: j.author_name ? `Video by ${j.author_name}` : null, imageUrl: ok ? big : j.thumbnail_url, text: [j.title, j.author_name].filter(Boolean).join(". ") };
      }
    } catch { /* fall through to the page itself */ }
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
