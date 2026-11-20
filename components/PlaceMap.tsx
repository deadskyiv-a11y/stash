"use client";

import { useEffect, useRef, useState } from "react";
import { searchPlaces, type Spot } from "@/lib/places";

/** A place box that offers real places as Kofi types. Picking one gives a map position, not just a word. */
export function PlaceInput({ value, placeholder, className, id, onText, onPick }: {
  value: string; placeholder: string; className: string; id?: string; onText: (v: string) => void; onPick: (s: Spot) => void;
}) {
  const [v, setV] = useState(value);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [focus, setFocus] = useState(false);
  // Set when a suggestion is picked, so leaving the box does not then save the half-typed text over it.
  const picked = useRef(false);

  useEffect(() => {
    const q = v.trim();
    if (!focus || q.length < 3 || q === value) return;
    const stop = new AbortController();
    const t = window.setTimeout(async () => setSpots(await searchPlaces(q, stop.signal)), 350);
    return () => { window.clearTimeout(t); stop.abort(); };
  }, [v, focus, value]);

  return (
    <span className="place">
      <input id={id} className={className} aria-label="Place" value={v} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { setV(e.target.value); if (e.target.value.trim().length < 3) setSpots([]); }}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); setSpots([]); if (picked.current) { picked.current = false; return; } if (v.trim() !== value) onText(v.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      {focus && spots.length > 0 && (
        <span className="spots">
          {spots.map((s, i) => (
            // Mouse down, not click: a click would arrive after the box has already lost focus and saved the bare text.
            <button key={i} type="button" onMouseDown={(e) => { e.preventDefault(); picked.current = true; setV(s.label); setSpots([]); onPick(s); (document.activeElement as HTMLElement | null)?.blur(); }}>{s.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

const TILE = 256;
const toTile = (lat: number, lng: number, z: number) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
const fromTile = (x: number, y: number, z: number) => {
  const n = 2 ** z;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lng: (x / n) * 360 - 180 };
};

/**
 * A small map with a pin. Click anywhere to move the pin there.
 * ponytail: a fixed grid of OpenStreetMap tiles around the pin, with zoom buttons and no dragging. Swap in a map library if he needs to pan.
 */
export function PinMap({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  const pinned = lat !== null && lng !== null;
  // With no pin yet, start on Ghana.
  const [z, setZ] = useState(pinned ? 14 : 6);
  const box = useRef<HTMLDivElement>(null);
  const c = toTile(pinned ? lat : 7.9, pinned ? lng : -1.0, z);
  const tiles: { x: number; y: number }[] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push({ x: Math.floor(c.x) + dx, y: Math.floor(c.y) + dy });
  const n = 2 ** z;

  return (
    <div className="pinmap">
      <div ref={box} className="pinmap-view" title="Click to place the pin"
        onClick={(e) => {
          const r = box.current!.getBoundingClientRect();
          const p = fromTile(c.x + (e.clientX - r.left - r.width / 2) / TILE, c.y + (e.clientY - r.top - r.height / 2) / TILE, z);
          onPick(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
        }}>
        {tiles.filter((t) => t.y >= 0 && t.y < n).map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${z}/${t.x}/${t.y}`} alt="" draggable={false} src={`https://tile.openstreetmap.org/${z}/${((t.x % n) + n) % n}/${t.y}.png`}
            style={{ left: `calc(50% + ${(t.x - c.x) * TILE}px)`, top: `calc(50% + ${(t.y - c.y) * TILE}px)` }} />
        ))}
        {pinned && <span className="pin" aria-hidden="true" />}
      </div>
      <div className="pinmap-bar">
        <span className="meta">{pinned ? "Click the map to move the pin." : "Click the map to drop a pin."} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></span>
        <span>
          <button type="button" className="pill-btn" aria-label="Zoom out" disabled={z <= 2} onClick={() => setZ((x) => x - 1)}>−</button>
          <button type="button" className="pill-btn" aria-label="Zoom in" disabled={z >= 18} onClick={() => setZ((x) => x + 1)}>+</button>
        </span>
      </div>
    </div>
  );
}
