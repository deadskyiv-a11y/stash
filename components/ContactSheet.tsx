"use client";

import { useEffect, useRef } from "react";

export type SheetPhoto = { id: string; name: string; url?: string; rating: number | null; number: number };

/**
 * A contact sheet: numbered thumbnails with file names, laid out for A4 paper.
 * It is hidden on screen and shown only to the printer, so "Save as PDF" in the browser's print box makes the PDF.
 * No PDF library: the browser already knows how to turn a page into one.
 */
export function ContactSheet({ title, note, photos, onDone }: { title: string; note: string; photos: SheetPhoto[]; onDone: () => void }) {
  const el = useRef<HTMLElement>(null);

  useEffect(() => {
    let gone = false;
    const done = () => onDone();
    window.addEventListener("afterprint", done);
    (async () => {
      // Wait for every thumbnail, or the sheet prints with holes in it.
      const imgs = [...(el.current?.querySelectorAll("img") || [])];
      await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
      if (!gone) window.print();
    })();
    return () => { gone = true; window.removeEventListener("afterprint", done); };
  }, [onDone]);

  return (
    <section ref={el} className="sheet" aria-hidden="true">
      <header>
        <h1>{title}</h1>
        <p>{note}</p>
      </header>
      <div className="sheet-grid">
        {photos.map((p) => (
          <figure key={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div>{p.url ? <img src={p.url} alt="" loading="eager" /> : null}</div>
            <figcaption><b>{p.number}</b> {p.name}{p.rating ? <span> {"★".repeat(p.rating)}</span> : null}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
