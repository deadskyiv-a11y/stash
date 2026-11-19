import type { Save } from "./types";

export const TILE_W = 150;
const GAP = 12;
const PITCH = TILE_W + GAP;
const SUB_GAP = 110;
const CLUSTER_GAP = 380;
const HEAD = 70;

export type Tile = { id: string; x: number; y: number; w: number; h: number };
export type Label = { key: string; name: string; count: number; x: number; y: number; cluster: string; sub: string | null };
export type Layout = { tiles: Tile[]; byId: Map<string, Tile>; clusters: Label[]; subs: Label[] };

/** Room under an article's picture for its headline, opening words and site. Matches .cap in globals.css. */
export const CAPTION_H = 100;

const MEDIA_SITES = /youtube|youtu\.be|instagram|tiktok|vimeo|spotify|imdb/i;

/** An article gets a caption. The AI labels new saves; older ones go by the site they came from. */
export function isArticle(s: Save): boolean {
  if (s.kind !== "link") return false;
  return s.form ? s.form === "article" : !MEDIA_SITES.test(s.site || "");
  // A recipe keeps its bare picture: the dish is the point, and the recipe is in the panel.
}

/** A quote is a note taken from a page, so it knows its source. A typed note has none. */
export function isQuote(s: Save): boolean {
  return s.kind === "note" && !!s.url;
}

/** Two addresses for the same page, ignoring the fragment, query and a trailing slash. */
export function samePage(a: string | null, b: string | null): boolean {
  const norm = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, ""); } catch { return u; } };
  return !!a && !!b && norm(a) === norm(b);
}

export function clusterOf(s: Save): string {
  if (s.status === "processing") return "Inbox";
  return s.cluster || "Unsorted";
}

function tileHeight(s: Save): number {
  if (s.image_path && s.image_w && s.image_h) {
    return Math.round(Math.min(280, Math.max(70, (TILE_W * s.image_h) / s.image_w))) + (isArticle(s) ? CAPTION_H : 0);
  }
  return isQuote(s) ? 150 : s.kind === "note" ? 110 : 100;
}

type Block = { name: string; saves: Save[]; w: number; h: number; tiles: Tile[] };

function masonry(saves: Save[]): Block["tiles"] & { w: number; h: number } {
  const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(saves.length * 1.4))));
  const heights = new Array(cols).fill(0);
  const tiles: Tile[] = [];
  for (const s of saves) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i;
    const h = tileHeight(s);
    tiles.push({ id: s.id, x: c * PITCH, y: heights[c], w: TILE_W, h });
    heights[c] += h + GAP;
  }
  return Object.assign(tiles, { w: cols * PITCH - GAP, h: Math.max(...heights) - GAP });
}

/** Packs rectangles left to right in rows no wider than maxWidth. */
function shelve<T extends { w: number; h: number }>(items: T[], maxWidth: number, gapX: number, gapY: number) {
  const placed: { item: T; x: number; y: number }[] = [];
  let x = 0, y = 0, rowH = 0, w = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > maxWidth) { x = 0; y += rowH + gapY; rowH = 0; }
    placed.push({ item, x, y });
    x += item.w + gapX;
    rowH = Math.max(rowH, item.h);
    w = Math.max(w, x - gapX);
  }
  return { placed, w, h: y + rowH };
}

export function computeLayout(saves: Save[]): Layout {
  const groups = new Map<string, Map<string, Save[]>>();
  const size = new Map<string, number>();
  const subSize = new Map<string, number>();
  for (const s of saves) {
    const c = clusterOf(s);
    size.set(c, (size.get(c) || 0) + 1);
    subSize.set(c + "/" + (s.subgroup || ""), (subSize.get(c + "/" + (s.subgroup || "")) || 0) + 1);
  }
  for (const s of saves) {
    const c = clusterOf(s);
    // Sub-groups split out as a cluster grows: none under 6 saves, and never a sub-group of one.
    const named = c !== "Inbox" && (size.get(c) || 0) >= 6 && (subSize.get(c + "/" + (s.subgroup || "")) || 0) >= 2;
    const sub = named ? s.subgroup || "" : "";
    if (!groups.has(c)) groups.set(c, new Map());
    const m = groups.get(c)!;
    if (!m.has(sub)) m.set(sub, []);
    m.get(sub)!.push(s);
  }

  const built = [...groups.entries()].map(([name, subsMap]) => {
    const subs = [...subsMap.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([subName, list]) => {
        const t = masonry(list);
        return { name: subName, saves: list, tiles: t as Tile[], w: Math.max(t.w, TILE_W), h: t.h + HEAD };
      });
    const packed = shelve(subs, 1900, SUB_GAP, SUB_GAP);
    const count = subs.reduce((n, s) => n + s.saves.length, 0);
    return { name, count, packed, w: packed.w, h: packed.h };
  });
  built.sort((a, b) => (a.name === "Inbox" ? 1 : b.name === "Inbox" ? -1 : b.count - a.count));

  const area = built.reduce((n, c) => n + (c.w + CLUSTER_GAP) * (c.h + CLUSTER_GAP), 0);
  const all = shelve(built, Math.max(2200, Math.sqrt(area) * 1.5), CLUSTER_GAP, CLUSTER_GAP);

  const tiles: Tile[] = [];
  const clusters: Label[] = [];
  const subs: Label[] = [];
  for (const c of all.placed) {
    clusters.push({ key: c.item.name, name: c.item.name, count: c.item.count, x: c.x, y: c.y + HEAD, cluster: c.item.name, sub: null });
    for (const s of c.item.packed.placed) {
      const ox = c.x + s.x;
      const oy = c.y + s.y + HEAD;
      if (s.item.name) {
        subs.push({ key: c.item.name + "/" + s.item.name, name: s.item.name, count: s.item.saves.length, x: ox, y: oy, cluster: c.item.name, sub: s.item.name });
      }
      for (const t of s.item.tiles) tiles.push({ ...t, x: ox + t.x, y: oy + t.y });
    }
  }
  return { tiles, byId: new Map(tiles.map((t) => [t.id, t])), clusters, subs };
}
