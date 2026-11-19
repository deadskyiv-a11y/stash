"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { connectDrive, driveConfigured, driveConnected, ensureFolder, uploadToDrive } from "@/lib/drive";
import { readPhoto } from "@/lib/photo-read";
import { Logo } from "./Logo";

const NAME = process.env.NEXT_PUBLIC_APP_NAME || "Stash";
const ROOT = "Stash Photos";

type Photo = {
  id: string; name: string; bytes: number | null; drive_id: string | null; drive_link: string | null; drive_folder: string | null;
  thumb_path: string | null; w: number | null; h: number | null; taken_at: string | null; lat: number | null; lng: number | null;
  place: string | null; camera: string | null; lens: string | null; film: string | null; settings: string | null; rating: number | null; keywords: string[]; created_at: string;
};
const COLUMNS = "id,name,bytes,drive_id,drive_link,drive_folder,thumb_path,w,h,taken_at,lat,lng,place,camera,lens,film,settings,rating,keywords,created_at";

const dateOf = (p: Photo) => new Date(p.taken_at || p.created_at);
const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const pad = (n: number) => String(n).padStart(2, "0");

/** A detail Kofi can type over. It saves when he leaves the box or presses Enter. */
function Field({ label, value, placeholder, type = "text", onSave }: { label: string; value: string; placeholder: string; type?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <dt>{label}</dt>
      <dd className="grow">
        <input className="inline" type={type} aria-label={label} value={v} placeholder={placeholder} autoComplete="off"
          onChange={(e) => setV(e.target.value)}
          onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </dd>
    </div>
  );
}

/** The photo room: Kofi's selects. Originals go to his Google Drive; thumbnails and details stay here. */
export function Photos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [group, setGroup] = useState<"date" | "place">("date");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [place, setPlace] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const signed = useRef(new Set<string>());
  const router = useRouter();

  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(""), 5000); }, []);

  useEffect(() => {
    queueMicrotask(() => setConnected(driveConnected()));
    (async () => {
      // The database hands back 1,000 rows at a time.
      const all: Photo[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase().from("photos").select(COLUMNS).order("taken_at", { ascending: false, nullsFirst: false }).range(from, from + 999);
        if (error) { say("Could not load your photos. " + error.message); break; }
        all.push(...((data as unknown as Photo[]) || []));
        if (!data || data.length < 1000) break;
      }
      setPhotos(all);
      setLoaded(true);
    })();
  }, [say]);

  // Thumbnails are private, so each needs a short-lived address.
  useEffect(() => {
    const need = photos.map((p) => p.thumb_path).filter((p): p is string => !!p && !signed.current.has(p));
    if (need.length === 0) return;
    need.forEach((p) => signed.current.add(p));
    (async () => {
      for (let i = 0; i < need.length; i += 100) {
        const { data } = await supabase().storage.from("saves").createSignedUrls(need.slice(i, i + 100), 60 * 60 * 12);
        if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string])) }));
      }
    })();
  }, [photos]);

  const deposit = useCallback(async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith("image/") || /\.(raf|cr2|cr3|nef|arw|dng|orf|rw2|heic|heif|tif|tiff)$/i.test(f.name));
    if (picked.length === 0) { say("Those are not pictures."); return; }
    if (!driveConnected()) { setAdding(true); say("Connect Google Drive first, then add the photos again."); return; }
    const { data } = await supabase().auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    const where = place.trim().slice(0, 80) || null;
    let done = 0, skipped = 0, failed = 0;
    setBusy({ done, total: picked.length });
    setAdding(false);
    for (const f of picked) {
      try {
        // The same file dropped twice is kept once.
        if (photos.some((p) => p.name === f.name && p.bytes === f.size)) { skipped++; continue; }
        const info = await readPhoto(f);
        const d = info.takenAt ? new Date(info.takenAt) : new Date();
        const folder = [ROOT, String(d.getFullYear()), `${d.getFullYear()}-${pad(d.getMonth() + 1)}`];
        const drive = await uploadToDrive(f, await ensureFolder(folder));
        const id = crypto.randomUUID();
        let thumb: string | null = null;
        if (info.thumb) {
          thumb = `${uid}/photos/${id}.jpg`;
          const up = await supabase().storage.from("saves").upload(thumb, info.thumb, { contentType: "image/jpeg" });
          if (up.error) thumb = null;
        }
        const { data: row, error } = await supabase().from("photos").insert({
          id, name: f.name, bytes: f.size, drive_id: drive.id, drive_link: drive.link, drive_folder: folder.join(" / "),
          thumb_path: thumb, w: info.w, h: info.h, taken_at: info.takenAt, lat: info.lat, lng: info.lng, place: where,
          camera: info.camera, lens: info.lens, settings: info.settings, rating: info.rating, keywords: info.keywords,
        }).select(COLUMNS).single();
        if (error || !row) throw new Error(error?.message || "Could not record the photo");
        setPhotos((all) => [row as unknown as Photo, ...all]);
      } catch (e) {
        failed++;
        console.error("Photo failed", f.name, e);
        if (!driveConnected()) { say("Google Drive needs connecting again. The rest were not uploaded."); setConnected(false); break; }
      } finally {
        done++;
        setBusy({ done, total: picked.length });
      }
    }
    setBusy(null);
    const ok = done - skipped - failed;
    say([`${ok} ${ok === 1 ? "photo" : "photos"} added.`, skipped ? `${skipped} already here.` : "", failed ? `${failed} failed.` : ""].filter(Boolean).join(" "));
  }, [photos, place, say]);

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])]; if (files.length) deposit(files); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(null); setAdding(false); }
      // Option+P switches between Stash and the photo room.
      if (e.altKey && e.code === "KeyP") { e.preventDefault(); router.push("/"); }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); window.removeEventListener("keydown", key); };
  }, [deposit, router]);

  const groups = useMemo(() => {
    const sorted = [...photos].sort((a, b) => dateOf(b).getTime() - dateOf(a).getTime());
    const map = new Map<string, Photo[]>();
    for (const p of sorted) {
      const k = group === "date" ? month(dateOf(p)) : p.place || "No place given";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    const out = [...map.entries()];
    return group === "place" ? out.sort((a, b) => b[1].length - a[1].length) : out;
  }, [photos, group]);

  const opened = open ? photos.find((p) => p.id === open) || null : null;

  // Kofi's own entries, for what the file does not say: a place, or the camera and film behind a scan.
  const edit = async (p: Photo, patch: Partial<Photo>) => {
    const { error } = await supabase().from("photos").update(patch).eq("id", p.id);
    if (error) { say("Could not save that. " + error.message); return; }
    setPhotos((all) => all.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  };
  const day = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const remove = async (p: Photo) => {
    const { error } = await supabase().from("photos").delete().eq("id", p.id);
    if (error) { say("Could not remove. " + error.message); return; }
    if (p.thumb_path) await supabase().storage.from("saves").remove([p.thumb_path]);
    setPhotos((all) => all.filter((x) => x.id !== p.id));
    setOpen(null);
  };

  return (
    <main className="app">
      <div className="list photos">
        {groups.map(([name, list]) => (
          <section key={name} className="pgroup">
            <h2 className="label cluster static">{name} <span>{list.length}</span></h2>
            <div className="pgrid">
              {list.map((p) => {
                const url = p.thumb_path ? urls[p.thumb_path] : undefined;
                const w = p.w && p.h ? Math.round((180 * p.w) / p.h) : 180;
                return (
                  <button key={p.id} type="button" className="ptile" style={{ width: w }} onClick={() => { setConfirmDelete(false); setOpen(p.id); }} aria-label={p.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="tile-text muted">{p.thumb_path ? "" : p.name}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {loaded && photos.length === 0 && !busy && (
        <div className="empty">
          <h2>No photos yet</h2>
          <p>Press Add photos, or drop your selects anywhere on this page.</p>
        </div>
      )}

      <header className="top">
        <div className="brand">
          <Link className="plain" href="/" aria-label={"Back to " + NAME}><Logo height={24} title={NAME} /></Link>
          <Link className="pill-btn link" href="/">Stash</Link>
          <span className="pill-btn link on">Photos</span>
        </div>
        <span className="count">{busy ? `Uploading ${Math.min(busy.done + 1, busy.total)} of ${busy.total}` : loaded ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"}` : ""}</span>
        <button type="button" className="ink save always" disabled={!!busy} onClick={() => setAdding((a) => !a)}>Add photos</button>
      </header>

      {adding && (
        <div className="adder">
          {!driveConfigured() ? (
            <p className="meta">Google Drive is not set up for Stash yet.</p>
          ) : !connected ? (
            <>
              <p className="meta">Your originals are kept in your Google Drive. Stash can only see the files it puts there.</p>
              <button type="button" className="ink" onClick={async () => { const ok = await connectDrive(); setConnected(ok); if (!ok) say("Google Drive was not connected."); }}>Connect Google Drive</button>
            </>
          ) : (
            <>
              <label htmlFor="place" className="sr">Where were these taken</label>
              <input id="place" className="field" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Where were these taken? Optional" autoComplete="off" />
              <div className="adder-actions">
                <span className="meta">Or drop them anywhere.</span>
                <button type="button" className="ink" onClick={() => file.current?.click()}>Choose photos</button>
              </div>
              <input ref={file} type="file" accept="image/*,.raf,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2" multiple hidden onChange={(e) => { deposit([...(e.target.files || [])]); e.target.value = ""; }} />
            </>
          )}
        </div>
      )}

      <footer className="bottom">
        <div className="bar">
          <button type="button" className={group === "date" ? "on" : ""} onClick={() => setGroup("date")}>Date</button>
          <button type="button" className={group === "place" ? "on" : ""} onClick={() => setGroup("place")}>Place</button>
        </div>
      </footer>

      {opened && (
        <aside className="detail" aria-label="Photo details">
          <button type="button" className="pill-btn close" onClick={() => setOpen(null)}>Close</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {opened.thumb_path && urls[opened.thumb_path] && <img src={urls[opened.thumb_path]} alt={opened.name} />}
          <h2>{opened.name}</h2>
          {opened.drive_link && <a className="pill-btn link" href={opened.drive_link} target="_blank" rel="noreferrer">Open the original in Drive</a>}
          <dl>
            <Field key={opened.id + "d"} label="Taken" type="date" value={day(opened.taken_at)} placeholder="Add a date" onSave={(v) => {
              // Keep the time of day the camera recorded; a typed date with no time sits at midday.
              const old = opened.taken_at ? new Date(opened.taken_at) : null;
              const at = v ? new Date(`${v}T${old ? `${pad(old.getHours())}:${pad(old.getMinutes())}:${pad(old.getSeconds())}` : "12:00:00"}`) : null;
              edit(opened, { taken_at: at && !isNaN(at.getTime()) ? at.toISOString() : null });
            }} />
            {opened.taken_at && <div><dt>Time</dt><dd>{new Date(opened.taken_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</dd></div>}
            <Field key={opened.id + "p"} label="Place" value={opened.place || ""} placeholder="Add a place" onSave={(v) => edit(opened, { place: v || null })} />
            {opened.lat !== null && opened.lng !== null && <div><dt>Position</dt><dd><a href={`https://www.google.com/maps?q=${opened.lat},${opened.lng}`} target="_blank" rel="noreferrer">{opened.lat.toFixed(4)}, {opened.lng.toFixed(4)}</a></dd></div>}
            <Field key={opened.id + "c"} label="Camera" value={opened.camera || ""} placeholder="Add a camera" onSave={(v) => edit(opened, { camera: v || null })} />
            <Field key={opened.id + "l"} label="Lens" value={opened.lens || ""} placeholder="Add a lens" onSave={(v) => edit(opened, { lens: v || null })} />
            <Field key={opened.id + "f"} label="Film" value={opened.film || ""} placeholder="Add a film stock" onSave={(v) => edit(opened, { film: v || null })} />
            {opened.settings && <div><dt>Settings</dt><dd>{opened.settings}</dd></div>}
            {opened.rating !== null && <div><dt>Rating</dt><dd>{opened.rating} of 5</dd></div>}
            {opened.drive_folder && <div><dt>In Drive</dt><dd>{opened.drive_folder}</dd></div>}
          </dl>
          {opened.keywords.length > 0 && <div className="tags">{opened.keywords.map((k) => <span key={k} className="pill-btn link">{k}</span>)}</div>}
          {confirmDelete
            ? <button type="button" className="ink" onClick={() => remove(opened)}>Confirm remove</button>
            : <button type="button" className="pill-btn" onClick={() => setConfirmDelete(true)}>Remove from Stash</button>}
          <p className="meta">Removing takes the photo out of Stash only. The original stays in your Drive.</p>
        </aside>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
