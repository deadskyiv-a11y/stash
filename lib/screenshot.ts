import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { privateIp } from "./fetch-page";

const VIEW = { width: 1280, height: 800 };
const LOCAL_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Pages that are a robot check, not the site itself. A picture of one of these is worse than no picture.
// Sites that show a sign-in wall to a visitor they do not know. A picture of that wall is not a picture of the post.
const WALLED = /(^|\.)(instagram|tiktok|facebook|x|twitter|linkedin|threads)\.(com|net)$/i;
const CHECKPOINT = /just a moment|security checkpoint|attention required|access denied|are you a robot|verify you are human|captcha/i;

/** True when a request the page wants to make is one Stash will allow: plain http(s), to a public address. */
async function allowed(raw: string): Promise<boolean> {
  try {
    const u = new URL(raw);
    if (u.protocol === "data:" || u.protocol === "blob:") return true; // content already inside the page
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (isIP(host)) return isIP(host) === 4 && !privateIp(host);
    const found = await lookup(host, { all: true });
    return found.length > 0 && !found.some((a) => privateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * Takes a picture of the top of a web page, for a saved link whose page offers no picture of its own.
 * A real browser opens the page, so sites that draw themselves with code come out as a person would see them.
 * Returns null when the page fails to load, answers with an error, or turns out to be a robot check.
 *
 * ponytail: one browser per screenshot, started and closed each time. Fine for one person's saves.
 * Keep a warm browser between requests if this ever feels slow.
 */
export async function screenshot(url: string): Promise<Buffer | null> {
  if (!(await allowed(url)) || WALLED.test(new URL(url).hostname)) return null;
  const puppeteer = (await import("puppeteer-core")).default;
  // On the server the browser comes from a package built for it. On this Mac, for testing, the installed Chrome is used.
  const onMac = process.platform === "darwin" && existsSync(LOCAL_CHROME);
  const chromium = onMac ? null : (await import("@sparticuz/chromium")).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || (chromium ? await chromium.executablePath() : LOCAL_CHROME),
    args: chromium ? chromium.args : ["--no-first-run", "--disable-extensions"],
    headless: true,
    defaultViewport: { ...VIEW, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    // Every request the page makes passes the same test as the link itself: nothing internal, nothing but the web.
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      try {
        if (await allowed(req.url())) await req.continue(); else await req.abort("blockedbyclient");
      } catch { /* the page went away mid-request */ }
    });
    // Saving a file or opening a pop-up is not something a screenshot needs.
    page.on("dialog", (d) => { d.dismiss().catch(() => null); });
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 15_000 }).catch(() => null);
    // A page that is slow to go quiet can still be worth a picture, as long as it answered at all.
    const status = res?.status() ?? (page.url().startsWith("http") ? 200 : 0);
    if (!status || status >= 400) return null;
    // Only web pages. A link straight to a PDF or a download has nothing to picture.
    if (res && !/text\/html|application\/xhtml/i.test(res.headers()["content-type"] || "text/html")) return null;
    await new Promise((r) => setTimeout(r, 1200)); // let fonts and opening animations settle
    const title = await page.title().catch(() => "");
    if (CHECKPOINT.test(title)) return null;
    const shot = await page.screenshot({ type: "jpeg", quality: 82, clip: { x: 0, y: 0, ...VIEW } });
    return Buffer.from(shot);
  } catch (e) {
    console.error("Screenshot failed", e);
    return null;
  } finally {
    await browser.close().catch(() => null);
  }
}
