"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPhoto = { id: string; lat: number; lng: number; url?: string };

const CELL = 76; // photos closer together than this many pixels on screen share one pin

/**
 * Every photo with a position, on a map that drags and zooms. Photos close together share one pin with a count.
 * Click a lone photo to open it. Click a group to zoom in, or, when they sit on the same spot, to list them.
 */
export function PhotoMap({ photos, onOpen, onSpot }: { photos: MapPhoto[]; onOpen: (id: string) => void; onSpot: (ids: string[]) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const data = useRef(photos);
  const act = useRef({ onOpen, onSpot });
  const [ready, setReady] = useState(false);
  useEffect(() => { act.current = { onOpen, onSpot }; });

  const draw = () => {
    const L = lib.current, m = map.current, g = layer.current;
    if (!L || !m || !g) return;
    g.clearLayers();
    const z = m.getZoom();
    const cells = new Map<string, MapPhoto[]>();
    for (const p of data.current) {
      const pt = m.project([p.lat, p.lng], z);
      const key = Math.floor(pt.x / CELL) + ":" + Math.floor(pt.y / CELL);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(p);
    }
    for (const group of cells.values()) {
      const lat = group.reduce((n, p) => n + p.lat, 0) / group.length, lng = group.reduce((n, p) => n + p.lng, 0) / group.length;
      // Built as elements, not as a string of HTML, so nothing in a file name or address can be read as markup.
      const pin = document.createElement("span");
      pin.className = "mpin";
      const first = group.find((p) => p.url);
      if (first?.url) { const img = document.createElement("img"); img.src = first.url; img.alt = ""; img.draggable = false; pin.appendChild(img); }
      if (group.length > 1) { const n = document.createElement("b"); n.textContent = String(group.length); pin.appendChild(n); }
      const marker = L.marker([lat, lng], { icon: L.divIcon({ html: pin, className: "mpin-wrap", iconSize: [52, 52], iconAnchor: [26, 26] }), keyboard: true, title: group.length > 1 ? `${group.length} photos` : "Photo" });
      marker.on("click", () => {
        if (group.length === 1) return act.current.onOpen(group[0].id);
        const bounds = L.latLngBounds(group.map((p) => [p.lat, p.lng] as [number, number]));
        const apart = bounds.getNorthEast().distanceTo(bounds.getSouthWest()) > 30; // metres
        if (apart && m.getZoom() < 18) m.fitBounds(bounds.pad(0.4), { maxZoom: 18 });
        else act.current.onSpot(group.map((p) => p.id));
      });
      marker.addTo(g);
    }
  };

  useEffect(() => {
    let gone = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (gone || !el.current) return;
      const m = L.map(el.current, { zoomControl: false, worldCopyJump: true }).setView([7.9, -1.0], 6);
      m.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
      lib.current = L; map.current = m; layer.current = L.layerGroup().addTo(m);
      m.on("zoomend", draw);
      setReady(true);
    })();
    return () => { gone = true; map.current?.remove(); map.current = null; };
  }, []);

  // New photos or a new filter: frame what is showing, then draw the pins.
  const shown = photos.map((p) => p.id).join(",");
  useEffect(() => {
    data.current = photos;
    const L = lib.current, m = map.current;
    if (!ready || !L || !m) return;
    if (photos.length) m.fitBounds(L.latLngBounds(photos.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: 15, animate: false });
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown]);

  // Thumbnail addresses arrive a moment after the photos do.
  const signed = photos.filter((p) => p.url).length;
  useEffect(() => {
    data.current = photos;
    if (ready) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signed]);

  return (
    <div className="pmap">
      <div ref={el} className="pmap-view" />
      <div className="bar pmap-zoom">
        <button type="button" className="round" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>−</button>
        <button type="button" className="round" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>+</button>
      </div>
    </div>
  );
}
