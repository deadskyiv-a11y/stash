"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One photograph filling the screen on the plain white ground.
 * Keys: arrows to move, 1 to 5 to rate, 0 to clear, X to archive or restore, I for details, Esc to leave.
 * Zoom: click a spot, pinch on a trackpad, roll a mouse wheel, press + and -, or use the buttons. Drag or swipe to move around.
 * The parent gives this a new key for each photo, so every photo starts fitted to the screen.
 */
export function BigView({ name, src, note, place, rating, info, canLoad, fetching, archived, onStep, onClose, onInfo, onRate, onLoad, onArchive }: {
  name: string; src?: string; note: string; place: string; rating: number | null; info: boolean; canLoad: boolean; fetching: boolean;
  onStep: (by: number) => void; onClose: () => void; onInfo: () => void; onRate: (n: number | null) => void; onLoad: () => void; archived: boolean; onArchive: () => void;
}) {
  const [zoom, setZoom] = useState(1); // 1 = the whole picture fits the screen
  const [fitW, setFitW] = useState(0); // the picture's width on screen at zoom 1
  const stage = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);

  // Zooms while keeping the point under the cursor (or the middle of the screen) where it is.
  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const st = stage.current, img = st?.querySelector("img");
    if (!st || !img) return;
    const box = st.getBoundingClientRect(), r = img.getBoundingClientRect();
    const x = cx ?? box.left + box.width / 2, y = cy ?? box.top + box.height / 2;
    const base = zoom === 1 ? r.width : fitW;
    if (zoom === 1) setFitW(r.width);
    const z = Math.min(12, Math.max(1, next));
    const fx = r.width ? (x - r.left) / r.width : 0.5, fy = r.height ? (y - r.top) / r.height : 0.5;
    const w = base * z, h = r.width ? (w * r.height) / r.width : 0;
    setZoom(z);
    requestAnimationFrame(() => {
      // Measured again here, because the picture's area widens once it is zoomed.
      const now = st.getBoundingClientRect();
      st.scrollLeft = fx * w - (x - now.left);
      st.scrollTop = fy * h - (y - now.top);
    });
  }, [zoom, fitW]);

  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    // A pinch on a trackpad arrives as a wheel event with Ctrl held. A mouse wheel zooms too. A two-finger swipe moves the picture.
    const wheel = (e: WheelEvent) => {
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (!e.ctrlKey && !e.metaKey && !mouseWheel) return;
      e.preventDefault();
      zoomTo(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    // Keys: arrows to move between photos, 1 to 5 to rate, 0 to clear, + and - to zoom, I for details, Esc to leave.
    const key = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onStep(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onStep(-1); }
      else if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
      else if (e.key.toLowerCase() === "i") onInfo();
      else if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.5);
      else if (e.key === "-" || e.key === "_") zoomTo(zoom / 1.5);
      else if (e.key.toLowerCase() === "x") onArchive();
      else if (/^[0-5]$/.test(e.key)) onRate(e.key === "0" ? null : Number(e.key));
    };
    st.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key, true);
    return () => { st.removeEventListener("wheel", wheel); window.removeEventListener("keydown", key, true); };
  }, [zoom, zoomTo, onStep, onClose, onInfo, onRate, onArchive]);

  return (
    <div className={"lightbox" + (info ? " with-info" : "")} role="dialog" aria-label={name}>
      <div ref={stage} className={"lb-stage" + (zoom > 1 ? " zoomed" : "")}
        onPointerDown={(e) => {
          if (zoom <= 1 || e.pointerType !== "mouse") return;
          const st = e.currentTarget;
          pan.current = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop, moved: false };
          st.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = pan.current;
          if (!d) return;
          if (e.buttons === 0) { pan.current = null; return; } // the button was let go somewhere a click did not follow
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
          e.currentTarget.scrollLeft = d.l - (e.clientX - d.x);
          e.currentTarget.scrollTop = d.t - (e.clientY - d.y);
        }}
        onClick={(e) => {
          // A click zooms in on that spot, or back out to the whole picture. The end of a drag is not a click.
          const dragged = pan.current?.moved;
          pan.current = null;
          if (!dragged) zoomTo(zoom > 1 ? 1 : 2.5, e.clientX, e.clientY);
        }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={name} draggable={false} style={zoom > 1 && fitW ? { width: fitW * zoom } : undefined} /> : <span className="muted">{name}</span>}
      </div>
      <div className="lb-top">
        <span className="meta">{place}  ·  {name}{note ? "  ·  " + note : ""}</span>
        <span className="lb-actions">
          <button type="button" className="pill-btn" onClick={onArchive}>{archived ? "Restore" : "Archive"}</button>
          {canLoad && <button type="button" className="pill-btn" disabled={fetching} onClick={onLoad}>{fetching ? "Fetching" : "Load the original"}</button>}
          <button type="button" className={info ? "ink" : "pill-btn"} onClick={onInfo}>Details</button>
          <button type="button" className="pill-btn" onClick={onClose}>Close</button>
        </span>
      </div>
      <button type="button" className="lb-nav prev" aria-label="Previous photo" onClick={() => onStep(-1)}>‹</button>
      <button type="button" className="lb-nav next" aria-label="Next photo" onClick={() => onStep(1)}>›</button>
      <div className="bar lb-zoom">
        <button type="button" className="round" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>−</button>
        <span className="zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="round" aria-label="Zoom in" disabled={zoom >= 12} onClick={() => zoomTo(zoom * 1.5)}>+</button>
      </div>
      <div className="lb-bottom rate" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={(rating || 0) >= n ? "on" : ""} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} onClick={() => onRate(rating === n ? null : n)}>★</button>
        ))}
      </div>
    </div>
  );
}
