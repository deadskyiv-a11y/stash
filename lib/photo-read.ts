"use client";

export type PhotoInfo = {
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  camera: string | null;
  lens: string | null;
  settings: string | null;
  rating: number | null;
  keywords: string[];
  thumb: Blob | null;
  w: number | null;
  h: number | null;
};

const THUMB = 640;

function draw(src: CanvasImageSource, sw: number, sh: number): Promise<{ blob: Blob | null; w: number; h: number }> {
  const k = Math.min(1, THUMB / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(src, 0, 0, w, h);
  // JPEG, because Safari cannot write WebP from a canvas.
  return new Promise((done) => c.toBlob((blob) => done({ blob, w, h }), "image/jpeg", 0.82));
}

/** Reads what the camera wrote into the file (date, place, camera, Lightroom rating and keywords) and makes a small picture of it. */
export async function readPhoto(file: File): Promise<PhotoInfo> {
  const info: PhotoInfo = { takenAt: null, lat: null, lng: null, camera: null, lens: null, settings: null, rating: null, keywords: [], thumb: null, w: null, h: null };
  const exifr = (await import("exifr")).default;
  try {
    const m = (await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })) || {};
    const when = m.DateTimeOriginal || m.CreateDate || m.ModifyDate;
    if (when instanceof Date && !isNaN(when.getTime())) info.takenAt = when.toISOString();
    if (typeof m.latitude === "number" && typeof m.longitude === "number") { info.lat = m.latitude; info.lng = m.longitude; }
    info.camera = [m.Make, m.Model].filter(Boolean).join(" ").replace(/^(\w+) \1/i, "$1").trim() || null;
    info.lens = typeof m.LensModel === "string" ? m.LensModel : null;
    const shutter = typeof m.ExposureTime === "number" ? (m.ExposureTime >= 1 ? `${m.ExposureTime}s` : `1/${Math.round(1 / m.ExposureTime)}s`) : "";
    info.settings = [m.FNumber ? `f/${m.FNumber}` : "", shutter, m.ISO ? `ISO ${m.ISO}` : "", m.FocalLength ? `${Math.round(m.FocalLength)}mm` : ""].filter(Boolean).join(" · ") || null;
    if (typeof m.Rating === "number" && m.Rating > 0) info.rating = Math.min(5, Math.round(m.Rating));
    const words = [m.subject, m.Keywords].flat().filter((k: unknown): k is string => typeof k === "string" && k.trim() !== "");
    info.keywords = [...new Set(words.map((k) => k.trim()))].slice(0, 30);
  } catch { /* a file with nothing readable inside still uploads */ }

  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const t = await draw(bmp, bmp.width, bmp.height);
    bmp.close();
    Object.assign(info, { thumb: t.blob, w: t.w, h: t.h });
  } catch {
    // RAW files, and HEIC outside Safari: the browser cannot open them, but most carry a small preview inside.
    try {
      const inner = await exifr.thumbnail(file);
      if (inner) {
        const bmp = await createImageBitmap(new Blob([new Uint8Array(inner)], { type: "image/jpeg" }));
        const t = await draw(bmp, bmp.width, bmp.height);
        bmp.close();
        Object.assign(info, { thumb: t.blob, w: t.w, h: t.h });
      }
    } catch { /* no picture; the tile shows the file name */ }
  }
  return info;
}
