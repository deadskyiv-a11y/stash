"use client";

import { memo, useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { Save } from "@/lib/types";
import { isArticle, isQuote, type Label, type Layout } from "@/lib/layout";

type Cam = { x: number; y: number; s: number };
export type CanvasHandle = { zoomBy: (f: number) => void; refit: () => void };

type Props = {
  saves: Save[];
  layout: Layout;
  hits: Set<string> | null;
  urls: Record<string, string>;
  focusKey: string;
  onOpen: (id: string) => void;
  onPick: (l: Label) => void;
  onZoom: (percent: number) => void;
};

const MIN = 0.04;
const MAX = 3;
const ease = (t: number) => 1 - Math.pow(1 - t, 4);

const Tiles = memo(function Tiles({ saves, layout, hits, urls }: Pick<Props, "saves" | "layout" | "hits" | "urls">) {
  return (
    <>
      {saves.map((s) => {
        const t = layout.byId.get(s.id);
        if (!t) return null;
        const url = s.image_path ? urls[s.image_path] : undefined;
        const dim = hits !== null && !hits.has(s.id);
        const article = !!s.image_path && isArticle(s);
        const quote = isQuote(s);
        const cls = ["tile", s.kind, url ? "has-image" : "", article ? "article" : "", quote ? "quote" : "", s.is_pale ? "pale" : "", s.status === "processing" ? "processing" : "", dim ? "dim" : ""].join(" ");
        return (
          <div key={s._key || s.id} data-id={s.id} className={cls} style={{ left: t.x, top: t.y, width: t.w, height: t.h }}>
            {url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={s.title || ""} loading="lazy" decoding="async" draggable={false} />
                {article && (
                  <span className="cap">
                    <b>{s.title}</b>
                    <span className="ex">{s.excerpt || s.summary}</span>
                    <span className="src">{s.site}</span>
                  </span>
                )}
              </>
            ) : s.status === "processing" ? (
              <span className="tile-text muted">Reading</span>
            ) : quote ? (
              <span className="tile-text">
                <span className="qm" aria-hidden="true">&ldquo;</span>
                <span className="qt">{s.note}</span>
                <span className="muted">{s.site}</span>
              </span>
            ) : s.kind === "note" ? (
              <span className="tile-text">{s.note || s.title}</span>
            ) : (
              <span className="tile-text">
                <span className="muted">{s.site}</span>
                {s.title}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
});

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { saves, layout, hits, urls, focusKey, onOpen, onPick, onZoom },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const anim = useRef(0);
  const drag = useRef<{ px: number; py: number; cx: number; cy: number; moved: boolean } | null>(null);
  const ready = useRef(false);
  const tapped = useRef(false);
  // Two fingers on a touch screen: pinch to zoom, move together to pan.
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number; cam: Cam } | null>(null);

  const apply = useCallback(() => {
    const w = world.current;
    const r = root.current;
    if (!w || !r) return;
    const c = cam.current;
    w.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.s})`;
    w.style.setProperty("--inv", String(1 / c.s));
    r.dataset.subs = c.s > 0.26 ? "1" : "0";
    onZoom(Math.round(c.s * 100));
  }, [onZoom]);

  const glide = useCallback((to: Cam, ms: number) => {
    cancelAnimationFrame(anim.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ms <= 0 || reduce) { cam.current = to; apply(); return; }
    const from = { ...cam.current };
    const start = performance.now();
    // Interpolate zoom on a log scale so a long flight feels even.
    const ls0 = Math.log(from.s), ls1 = Math.log(to.s);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      cam.current = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, s: Math.exp(ls0 + (ls1 - ls0) * k) };
      apply();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [apply]);

  const target = useCallback((): Cam | null => {
    const r = root.current;
    if (!r) return null;
    const some = hits !== null && hits.size > 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of layout.tiles) {
      if (some && !hits!.has(t.id)) continue;
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
    }
    if (!isFinite(x0)) return { x: r.clientWidth / 2, y: r.clientHeight / 2, s: 1 };
    // ponytail: labels keep screen size, so reserve a fixed strip on the right for a name wider than its tiles.
    // A phone has a two-row header and no room to spare at the sides.
    const small = r.clientWidth < 640;
    const top = small ? 140 : 150, bottom = small ? 90 : 110, labelRoom = small ? 40 : 160;
    const availW = Math.max(200, r.clientWidth - (small ? 32 : 160) - labelRoom);
    const availH = Math.max(200, r.clientHeight - top - bottom);
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const s = Math.max(MIN, Math.min(availW / bw, availH / bh, some ? 2.2 : 1));
    return { x: (r.clientWidth - labelRoom) / 2 - (x0 + bw / 2) * s, y: top + availH / 2 - (y0 + bh / 2) * s, s };
  }, [hits, layout]);

  // Fly to the matches whenever the search, filters or the set of saves change.
  useEffect(() => {
    const to = target();
    if (!to) return;
    glide(to, ready.current ? 1100 : 0);
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, layout]);

  const zoomAt = useCallback((mx: number, my: number, ns: number, ms: number) => {
    const c = cam.current;
    const s = Math.max(MIN, Math.min(MAX, ns));
    const k = s / c.s;
    glide({ x: mx - (mx - c.x) * k, y: my - (my - c.y) * k, s }, ms);
  }, [glide]);

  useImperativeHandle(ref, () => ({
    zoomBy: (f: number) => {
      const r = root.current;
      if (r) zoomAt(r.clientWidth / 2, r.clientHeight / 2, cam.current.s * f, 350);
    },
    refit: () => { const to = target(); if (to) glide(to, 1100); },
  }), [zoomAt, target, glide]);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const rect = r.getBoundingClientRect();
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const power = e.ctrlKey ? 0.01 : 0.0015;
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, cam.current.s * Math.exp(-e.deltaY * power), 0);
      } else {
        cam.current = { ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY };
        apply();
      }
    };
    r.addEventListener("wheel", onWheel, { passive: false });
    const onResize = () => apply();
    window.addEventListener("resize", onResize);
    return () => { r.removeEventListener("wheel", onWheel); window.removeEventListener("resize", onResize); };
  }, [apply, zoomAt]);

  return (
    <div
      ref={root}
      className="canvas"
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        cancelAnimationFrame(anim.current);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { px: e.clientX, py: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
        fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (fingers.current.size === 2) {
          const [a, b] = [...fingers.current.values()];
          pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...cam.current } };
          drag.current = null;
        }
      }}
      onPointerMove={(e) => {
        if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = pinch.current;
        if (p && fingers.current.size >= 2) {
          const [a, b] = [...fingers.current.values()];
          const s = Math.max(MIN, Math.min(MAX, p.cam.s * (Math.hypot(a.x - b.x, a.y - b.y) / p.d)));
          const k = s / p.cam.s;
          // Keep the point that was between the fingers under them as they move.
          cam.current = { x: (a.x + b.x) / 2 - (p.mx - p.cam.x) * k, y: (a.y + b.y) / 2 - (p.my - p.cam.y) * k, s };
          apply();
          return;
        }
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.px, dy = e.clientY - d.py;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        d.moved = true;
        cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy };
        apply();
      }}
      onPointerUp={(e) => {
        fingers.current.delete(e.pointerId);
        if (pinch.current) {
          // Pinch over. If one finger stays down, carry on as a pan from where it is, and never open a tile.
          pinch.current = null;
          const [rest] = [...fingers.current.values()];
          drag.current = rest ? { px: rest.x, py: rest.y, cx: cam.current.x, cy: cam.current.y, moved: true } : null;
          return;
        }
        const d = drag.current;
        drag.current = null;
        tapped.current = !!d && !d.moved;
      }}
      // Open on the click, not the finger lift: on a touch screen the click comes after, and would
      // otherwise land on whatever the newly opened panel put under the finger (its link, a tag, Delete).
      onClick={(e) => {
        if (!tapped.current) return;
        tapped.current = false;
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const id = el?.closest<HTMLElement>("[data-id]")?.dataset.id;
        if (id) onOpen(id);
      }}
      onPointerCancel={(e) => { fingers.current.delete(e.pointerId); pinch.current = null; drag.current = null; }}
    >
      <div ref={world} className="world">
        <Tiles saves={saves} layout={layout} hits={hits} urls={urls} />
        {layout.subs.map((l) => (
          <button key={l.key} type="button" className="label sub" style={{ left: l.x, top: l.y }} onClick={() => onPick(l)}>
            {l.name} <span>{l.count}</span>
          </button>
        ))}
        {layout.clusters.map((l) => (
          <button key={l.key} type="button" className="label cluster" style={{ left: l.x, top: `calc(${l.y}px - 26px * var(--inv))` }} onClick={() => onPick(l)}>
            {l.name} <span>{l.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
