"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, supabase } from "@/lib/supabase-browser";
import { connectDrive, downloadFromDrive, driveConfigured, driveConnected, driveMinutesLeft, ensureFolder, streamFromDrive, uploadToDrive } from "@/lib/drive";
import { chooseZipPlace, uniqueNames, writeZip } from "@/lib/export-zip";
import { readPhoto } from "@/lib/photo-read";
import { nameOf } from "@/lib/places";
import { Logo } from "./Logo";
import { PinMap, PlaceInput } from "./PlaceMap";
import { PhotoMap } from "./PhotoMap";
import { BigView } from "./BigView";
import { ContactSheet } from "./ContactSheet";
import { UploadBar, type Upload } from "./UploadBar";

const NAME = process.env.NEXT_PUBLIC_APP_NAME || "Stash";
const ROOT = "Stash Photos";

type Photo = {
  id: string; name: string; bytes: number | null; drive_id: string | null; drive_link: string | null; drive_folder: string | null;
  thumb_path: string | null; w: number | null; h: number | null; taken_at: string | null; lat: number | null; lng: number | null;
  place: string | null; camera: string | null; lens: string | null; film: string | null; settings: string | null; rating: number | null; keywords: string[]; created_at: string;
  tags: string[]; caption: string | null; subject: string | null; tagged: boolean; projects: string[]; view_path: string | null; archived: boolean;
};
const COLUMNS = "id,name,bytes,drive_id,drive_link,drive_folder,thumb_path,w,h,taken_at,lat,lng,place,camera,lens,film,settings,rating,keywords,created_at,tags,caption,subject,tagged,projects,view_path,archived";

const dateOf = (p: Photo) => new Date(p.taken_at || p.created_at);
const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const pad = (n: number) => String(n).padStart(2, "0");

/** A detail Kofi can type over. It saves when he leaves the box or presses Enter. */
function Field({ label, value, placeholder, type = "text", list, onSave }: { label: string; value: string; placeholder: string; type?: string; list?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <dt>{label}</dt>
      <dd className="grow">
        <input className="inline" type={type} list={list} aria-label={label} value={v} placeholder={placeholder} autoComplete="off"
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
  const [group, setGroup] = useState<"date" | "place" | "subject" | "project" | "order">("date");
  // Each project's photographs in the order Kofi has put them, first to last.
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const dragged = useRef(false); // true just after a drag, so the click that ends it does not open the photo
  const [only, setOnly] = useState(""); // show just this project
  const [view, setView] = useState<"grid" | "map">("grid");
  const [sheet, setSheet] = useState(false); // the contact sheet is being printed
  const closeSheet = useCallback(() => setSheet(false), []);
  const [inArchive, setInArchive] = useState(false); // looking at archived photos instead of live ones
  const [spot, setSpot] = useState<string[] | null>(null); // photos sharing one pin on the map
  const [waiting, setWaiting] = useState<File[] | null>(null); // a batch paused until Drive is reconnected
  // The large view: one photo filling the screen, with arrows to move between neighbours.
  const [big, setBig] = useState(false);
  const [info, setInfo] = useState(false);
  const [views, setViews] = useState<Record<string, string>>({});
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  const [q, setQ] = useState("");
  const [stars, setStars] = useState(0); // show only photos rated at least this
  const [reading, setReading] = useState(0); // photos the AI still has to look at
  const queued = useRef(new Set<string>());
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [place, setPlace] = useState("");
  const [placeAt, setPlaceAt] = useState<{ lat: number; lng: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<Upload | null>(null);
  const halt = useRef(false); // set by Stop: finish the photo in hand, then end the batch
  const exporting = useRef<AbortController | null>(null);
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Select mode: tap photos to pick several, then set a detail on all of them at once.
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const last = useRef<string | null>(null);
  const [round, setRound] = useState(0); // bumps after each set-on-all, to empty the boxes
  const file = useRef<HTMLInputElement>(null);
  const signed = useRef(new Set<string>());
  const router = useRouter();

  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(""), 5000); }, []);

  useEffect(() => {
    queueMicrotask(() => setConnected(driveConnected()));
    supabase().from("project_orders").select("project,ids").then(({ data }) => {
      if (data) setOrders(Object.fromEntries(data.map((r) => [r.project as string, r.ids as string[]])));
    });
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

  // The AI looks at each new thumbnail, one at a time, and writes its subject, tags and a description.
  useEffect(() => {
    const todo = photos.filter((p) => !p.tagged && p.thumb_path && !queued.current.has(p.id));
    if (todo.length === 0) return;
    todo.forEach((p) => queued.current.add(p.id));
    queueMicrotask(() => setReading((n) => n + todo.length));
    (async () => {
      let failures = 0;
      for (const p of todo) {
        // After three failures in a row the AI is taken to be unavailable; the rest are tried again on the next visit.
        if (failures < 3) {
          try {
            const r = await api<{ photo: Pick<Photo, "id" | "tags" | "caption" | "subject" | "tagged"> }>("/api/photos/tag", { id: p.id });
            setPhotos((all) => all.map((x) => (x.id === p.id ? { ...x, ...r.photo } : x)));
            failures = 0;
          } catch { failures++; }
        }
        setReading((n) => n - 1);
      }
    })();
  }, [photos]);

  const deposit = useCallback(async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith("image/") || /\.(raf|cr2|cr3|nef|arw|dng|orf|rw2|heic|heif|tif|tiff)$/i.test(f.name));
    if (picked.length === 0) { say("Those are not pictures."); return; }
    // Start a batch on a fresh pass, so it has the full hour. If the browser blocks Google's window, hold the batch.
    if (driveMinutesLeft() < 20 && !(await connectDrive(true))) { setAdding(false); setConnected(driveConnected()); setWaiting(picked); return; }
    setConnected(true);
    const { data } = await supabase().auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    const where = place.trim().slice(0, 80) || null;
    let done = 0, skipped = 0, failed = 0;
    // The bar measures the whole batch in bytes, so one large file does not look like a stall.
    const size = picked.reduce((n, f) => n + f.size, 0), started = Date.now();
    let before = 0;
    halt.current = false;
    setBusy({ done, total: picked.length, name: picked[0].name, sent: 0, size, secs: 0, stopping: false });
    setAdding(false);
    let held = 0;
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      if (halt.current) { say(`Stopped. ${picked.length - i} ${picked.length - i === 1 ? "photo was" : "photos were"} not uploaded.`); break; }
      setBusy((u) => u && { ...u, name: f.name });
      // Renew a pass that is about to run out. If that needs a click, pause here and keep what is left.
      if (driveMinutesLeft() < 3 && !(await connectDrive(true))) { held = picked.length - i; setWaiting(picked.slice(i)); setConnected(false); break; }
      try {
        // The same file dropped twice is kept once.
        if (photos.some((p) => p.name === f.name && p.bytes === f.size)) { skipped++; continue; }
        const info = await readPhoto(f);
        // The camera's own position wins. Failing that, the place picked for the batch. A photo with a position and no name gets the name looked up.
        const lat = info.lat ?? placeAt?.lat ?? null, lng = info.lng ?? placeAt?.lng ?? null;
        const named = where || (info.lat !== null && info.lng !== null ? await nameOf(info.lat, info.lng) : null);
        const d = info.takenAt ? new Date(info.takenAt) : new Date();
        const folder = [ROOT, String(d.getFullYear()), `${d.getFullYear()}-${pad(d.getMonth() + 1)}`];
        const base = before;
        const drive = await uploadToDrive(f, await ensureFolder(folder), (sent) => { const secs = (Date.now() - started) / 1000; setBusy((u) => u && { ...u, sent: base + sent, secs }); });
        const id = crypto.randomUUID();
        let thumb: string | null = null;
        if (info.thumb) {
          thumb = `${uid}/photos/${id}.jpg`;
          const up = await supabase().storage.from("saves").upload(thumb, info.thumb, { contentType: "image/jpeg" });
          if (up.error) thumb = null;
        }
        let view: string | null = null;
        if (info.view) {
          view = `${uid}/photos/${id}-view.jpg`;
          const up = await supabase().storage.from("saves").upload(view, info.view, { contentType: "image/jpeg" });
          if (up.error) view = null;
        }
        const { data: row, error } = await supabase().from("photos").insert({
          id, name: f.name, bytes: f.size, drive_id: drive.id, drive_link: drive.link, drive_folder: folder.join(" / "),
          thumb_path: thumb, view_path: view, w: info.w, h: info.h, taken_at: info.takenAt, lat, lng, place: named,
          camera: info.camera, lens: info.lens, settings: info.settings, rating: info.rating, keywords: info.keywords,
        }).select(COLUMNS).single();
        if (error || !row) throw new Error(error?.message || "Could not record the photo");
        setPhotos((all) => [row as unknown as Photo, ...all]);
      } catch (e) {
        console.error("Photo failed", f.name, e);
        // Drive turned the pass away mid-batch: hold this photo and the rest, to carry on after a reconnect.
        if (!driveConnected()) { held = picked.length - i; setWaiting(picked.slice(i)); setConnected(false); break; }
        failed++;
      } finally {
        done++;
        before += f.size;
        const sent = before;
        setBusy((u) => u && { ...u, done, sent });
      }
    }
    setBusy(null);
    const ok = done - skipped - failed;
    if (held) { say(`Paused. ${held} ${held === 1 ? "photo is" : "photos are"} waiting for Google Drive.`); return; }
    say([`${ok} ${ok === 1 ? "photo" : "photos"} added.`, skipped ? `${skipped} already here.` : "", failed ? `${failed} failed.` : ""].filter(Boolean).join(" "));
  }, [photos, place, placeAt, say]);

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

  // Order mode only makes sense inside one project. Without a project picked it falls back to dates.
  const ordering = group === "order" && only !== "";
  // A project's full sequence: the saved order first, then any photo not yet placed, oldest first.
  const sequenceOf = useCallback((project: string) => {
    const mine = photos.filter((p) => p.projects.includes(project));
    const have = new Set(mine.map((p) => p.id));
    const saved = (orders[project] || []).filter((id) => have.has(id));
    const placed = new Set(saved);
    const rest = mine.filter((p) => !placed.has(p.id)).sort((a, b) => dateOf(a).getTime() - dateOf(b).getTime()).map((p) => p.id);
    return [...saved, ...rest];
  }, [photos, orders]);

  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const sorted = [...photos].sort((a, b) => dateOf(b).getTime() - dateOf(a).getTime());
    const map = new Map<string, Photo[]>();
    for (const p of sorted) {
      if (p.archived !== inArchive) continue; // archived photos are out of sight until the archive is opened
      if (stars && (p.rating || 0) < stars) continue;
      if (only && !p.projects.includes(only)) continue;
      if (words.length) {
        // Every word typed must appear somewhere in what is known about the photo.
        const hay = [p.name, p.place, p.subject, p.caption, p.camera, p.lens, p.film, p.settings, month(dateOf(p)), p.tags.join(" "), p.keywords.join(" "), p.projects.join(" "), p.rating ? `${p.rating} stars` : ""].join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      // A photo in several projects shows under each of them.
      const keys = ordering ? [only] : group === "project" ? (p.projects.length ? p.projects : ["No project"])
        : [group === "date" || group === "order" ? month(dateOf(p)) : group === "place" ? p.place || "No place given" : p.subject || (p.tagged ? "Other" : "Not read yet")];
      for (const k of keys) {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(p);
      }
    }
    if (ordering) {
      const rank = new Map(sequenceOf(only).map((id, i) => [id, i]));
      return [...map.entries()].map(([k, list]) => [k, [...list].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))] as [string, Photo[]]);
    }
    const out = [...map.entries()];
    return group === "date" ? out : out.sort((a, b) => b[1].length - a[1].length);
  }, [photos, group, q, stars, only, inArchive, ordering, sequenceOf]);
  const archivedCount = useMemo(() => photos.filter((p) => p.archived).length, [photos]);
  const pool = inArchive ? archivedCount : photos.length - archivedCount;
  const showing = new Set(groups.flatMap(([, list]) => list.map((p) => p.id))).size;
  // What the map shows: every photo passing the current search and filters that has a position.
  const onMap = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; lat: number; lng: number; url?: string }[] = [];
    for (const [, list] of groups) for (const p of list) {
      if (seen.has(p.id) || p.lat === null || p.lng === null) continue;
      seen.add(p.id);
      out.push({ id: p.id, lat: p.lat, lng: p.lng, url: p.thumb_path ? urls[p.thumb_path] : undefined });
    }
    return out;
  }, [groups, urls]);
  const projects = useMemo(() => [...new Set(photos.flatMap((p) => p.projects))].sort((a, b) => a.localeCompare(b)), [photos]);

  const opened = open ? photos.find((p) => p.id === open) || null : null;

  const order = useMemo(() => groups.flatMap(([, list]) => list.map((p) => p.id)), [groups]);
  // The large view steps through the photos in the order they are showing, each one once.
  const sequence = useMemo(() => [...new Set(order)], [order]);
  const at = open ? sequence.indexOf(open) : -1;
  const closeBig = useCallback(() => { setBig(false); setInfo(false); setOpen(null); }, []);
  const step = useCallback((by: number) => {
    if (at < 0 || sequence.length === 0) return;
    setConfirmDelete(false);
    setOpen(sequence[(at + by + sequence.length) % sequence.length]);
  }, [at, sequence]);

  // Large previews are private too. Sign the one on screen and its neighbours, so stepping feels instant.
  useEffect(() => {
    if (!big || at < 0) return;
    const need = [0, 1, -1].map((d) => photos.find((p) => p.id === sequence[(at + d + sequence.length) % sequence.length])?.view_path)
      .filter((p): p is string => !!p && !views[p]);
    if (need.length === 0) return;
    supabase().storage.from("saves").createSignedUrls([...new Set(need)], 60 * 60 * 6).then(({ data }) => {
      if (data) setViews((v) => ({ ...v, ...Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string])) }));
    });
  }, [big, at, sequence, photos, views]);

  const pick = (id: string, range: boolean) => {
    setChosen((old) => {
      const next = new Set(old);
      const a = last.current ? order.indexOf(last.current) : -1, b = order.indexOf(id);
      // Shift-click picks everything between the last photo clicked and this one.
      if (range && a >= 0 && b >= 0) for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    last.current = id;
  };
  const pickGroup = (ids: string[]) => setChosen((old) => {
    const next = new Set(old);
    const all = ids.every((id) => next.has(id));
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    return next;
  });
  const stopSelecting = () => { setSelecting(false); setChosen(new Set()); last.current = null; };

  // Kofi's own entries, for what the file does not say: a place, or the camera and film behind a scan.
  const edit = async (p: Photo, patch: Partial<Photo>) => {
    const { error } = await supabase().from("photos").update(patch).eq("id", p.id);
    if (error) { say("Could not save that. " + error.message); return; }
    setPhotos((all) => all.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  };
  const editMany = async (patch: Partial<Photo>) => {
    const ids = [...chosen];
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase().from("photos").update(patch).in("id", ids.slice(i, i + 200));
      if (error) { say("Could not save that. " + error.message); return; }
    }
    setPhotos((all) => all.map((x) => (chosen.has(x.id) ? { ...x, ...patch } : x)));
    setRound((r) => r + 1);
    say(`Set on ${ids.length} ${ids.length === 1 ? "photo" : "photos"}.`);
  };
  // Put photos into a project, or take them out. One photo can be in several.
  const setProject = async (ids: string[], name: string, add: boolean) => {
    const project = name.trim().slice(0, 60);
    if (!project || ids.length === 0) return;
    const { error } = await supabase().rpc("set_photo_project", { ids, project, add });
    if (error) { say("Could not save that. " + error.message); return; }
    const hit = new Set(ids);
    setPhotos((all) => all.map((x) => (!hit.has(x.id) ? x : { ...x, projects: add ? (x.projects.includes(project) ? x.projects : [...x.projects, project]) : x.projects.filter((p) => p !== project) })));
    setRound((r) => r + 1);
    if (!add && only === project && !photos.some((x) => !hit.has(x.id) && x.projects.includes(project))) setOnly("");
    if (ids.length > 1) say(add ? `Added ${ids.length} photos to ${project}.` : `Took ${ids.length} photos out of ${project}.`);
  };
  // Fetches the full original from Drive, to judge sharpness at real size.
  const loadOriginal = async (p: Photo) => {
    if (!p.drive_id) return;
    if (!driveConnected() && !(await connectDrive(true))) { say("Connect Google Drive first, under Add photos."); return; }
    setConnected(true);
    setFetching(true);
    try {
      const blob = await downloadFromDrive(p.drive_id);
      setOriginals((o) => ({ ...o, [p.id]: URL.createObjectURL(blob) }));
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not fetch the original.");
    }
    setFetching(false);
  };

  // Moves one photo to just before another in the project's order (or to the end), and saves the whole order.
  const reorder = async (id: string, before: string | null) => {
    if (!ordering || id === before) return;
    const ids = sequenceOf(only).filter((x) => x !== id);
    const i = before ? ids.indexOf(before) : -1;
    if (i < 0) ids.push(id); else ids.splice(i, 0, id);
    setOrders((o) => ({ ...o, [only]: ids }));
    const { error } = await supabase().from("project_orders").upsert({ project: only, ids, updated_at: new Date().toISOString() }, { onConflict: "user_id,project" });
    if (error) say("Could not save the order. " + error.message);
  };
  // Dragging to reorder, done with the pointer alone. The browser's own drag-and-drop is avoided on purpose:
  // it hands the picture to the operating system, which wakes any drag-shelf app the moment a photo is picked up.
  const startMove = (id: string, x0: number, y0: number) => {
    let moving = false;
    let target: { id: string; after: boolean } | null = null;
    const move = (e: PointerEvent) => {
      if (!moving && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) < 6) return;
      if (!moving) { moving = true; setDragging(id); }
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-pid]");
      const pid = el?.dataset.pid;
      if (el && pid && pid !== id) {
        const r = el.getBoundingClientRect();
        target = { id: pid, after: e.clientX > r.left + r.width / 2 };
      } else target = null;
      setOver(target);
      // Near the top or bottom edge, scroll the page along.
      const list = document.querySelector<HTMLElement>(".list.photos");
      if (list) { if (e.clientY < 140) list.scrollBy(0, -18); else if (e.clientY > window.innerHeight - 120) list.scrollBy(0, 18); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(null);
      setOver(null);
      if (!moving) return;
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
      if (!target) return;
      // Dropped on the right half of a photo: place it after that one, which is just before the next.
      const ids = sequenceOf(only).filter((v) => v !== id);
      const i = ids.indexOf(target.id);
      reorder(id, target.after ? ids[i + 1] ?? null : target.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // One place earlier or later, for the phone and the keyboard, where dragging is awkward.
  const nudge = (id: string, by: number) => {
    const ids = sequenceOf(only), i = ids.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    reorder(id, by < 0 ? ids[j] : ids[j + 1] ?? null);
  };

  // Archive puts photos out of sight without removing them. Restore brings them back.
  const setArchived = async (ids: string[], archived: boolean) => {
    if (ids.length === 0) return;
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase().from("photos").update({ archived }).in("id", ids.slice(i, i + 200));
      if (error) { say("Could not save that. " + error.message); return; }
    }
    const hit = new Set(ids);
    // In the large view, move on to the next photo that is staying.
    if (open && hit.has(open)) {
      const next = sequence.slice(at + 1).concat(sequence.slice(0, at)).find((id) => !hit.has(id));
      if (big && next) setOpen(next); else { setBig(false); setInfo(false); setOpen(null); }
    }
    setPhotos((all) => all.map((x) => (hit.has(x.id) ? { ...x, archived } : x)));
    setChosen(new Set());
    if (!archived && archivedCount - ids.length <= 0) setInArchive(false);
    say(`${archived ? "Archived" : "Restored"} ${ids.length} ${ids.length === 1 ? "photo" : "photos"}.`);
  };

  // Export: the originals of the given photos, fetched from Drive and put into one zip file.
  const exportPhotos = async (ids: string[], label: string, numbered: boolean) => {
    const list = ids.map((id) => photos.find((p) => p.id === id)).filter((p): p is Photo => !!p && !!p.drive_id);
    if (list.length === 0) { say("There are no originals to export."); return; }
    // Google's window and the save box each need their own click, so a stale Drive pass is renewed first and Export pressed again.
    if (driveMinutesLeft() < 20) {
      const ok = await connectDrive(true);
      setConnected(ok);
      say(ok ? "Google Drive is connected. Press Export again." : "Connect Google Drive first, under Add photos.");
      return;
    }
    const today = new Date();
    const file = `${label} ${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.zip`;
    let place: Awaited<ReturnType<typeof chooseZipPlace>> = null;
    try { place = await chooseZipPlace(file); } catch { return; } // he closed the save box
    const names = uniqueNames(list.map((p, i) => (numbered ? `${String(i + 1).padStart(3, "0")} ${p.name}` : p.name)));
    const size = list.reduce((n, p) => n + (p.bytes || 0), 0), started = Date.now();
    const ctl = new AbortController();
    exporting.current = ctl;
    setBusy({ done: 0, total: list.length, name: list[0].name, sent: 0, size, secs: 0, stopping: false, verb: "Exporting" });
    try {
      await writeZip(
        list.map((p, i) => ({ name: names[i], modified: dateOf(p), open: () => streamFromDrive(p.drive_id!, ctl.signal) })),
        file, place, ctl.signal,
        (i) => setBusy((u) => u && { ...u, done: i, name: list[i].name }),
        (sent) => { const secs = (Date.now() - started) / 1000; setBusy((u) => u && { ...u, sent, secs }); },
      );
      say(`Exported ${list.length} ${list.length === 1 ? "original" : "originals"} to ${file}.`);
    } catch (e) {
      say(ctl.signal.aborted ? "Export stopped. The zip was not finished." : e instanceof Error ? e.message + " The zip was not finished." : "The export failed.");
    }
    exporting.current = null;
    setBusy(null);
  };

  const toggleInfo = useCallback(() => setInfo((x) => !x), []);
  const rate = (n: number | null) => { if (opened) edit(opened, { rating: n }); };
  const day = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const remove = async (p: Photo) => {
    const { error } = await supabase().from("photos").delete().eq("id", p.id);
    if (error) { say("Could not remove. " + error.message); return; }
    const stored = [p.thumb_path, p.view_path].filter((x): x is string => !!x);
    if (stored.length) await supabase().storage.from("saves").remove(stored);
    setPhotos((all) => all.filter((x) => x.id !== p.id));
    setOpen(null);
  };

  return (
    <main className="app">
      {view === "map" && <PhotoMap photos={onMap} onOpen={(id) => { setSpot(null); setConfirmDelete(false); setOpen(id); }} onSpot={(ids) => { setOpen(null); setSpot(ids); }} />}
      {view === "map" && loaded && showing > onMap.length && (
        <p className="pmap-note">{showing - onMap.length} {showing - onMap.length === 1 ? "photo has" : "photos have"} no place yet, so {showing - onMap.length === 1 ? "it is" : "they are"} not on the map.</p>
      )}
      <div className={"list photos" + (selecting || (opened && !big) ? " with-panel" : "")} hidden={view === "map"}>
        {groups.map(([name, list]) => (
          <section key={name} className="pgroup">
            <h2 className="label cluster static">{name} <span>{list.length}</span>
              {selecting && <button type="button" className="pill-btn small" onClick={() => pickGroup(list.map((p) => p.id))}>{list.every((p) => chosen.has(p.id)) ? "Clear these" : "Select these"}</button>}
            </h2>
            <div className="pgrid">
              {list.map((p) => {
                const url = p.thumb_path ? urls[p.thumb_path] : undefined;
                const w = p.w && p.h ? Math.round((180 * p.w) / p.h) : 180;
                return (
                  <button key={p.id} type="button" className={"ptile" + (chosen.has(p.id) ? " chosen" : "") + (ordering && !selecting ? " movable" : "") + (over?.id === p.id && dragging !== p.id ? (over.after ? " drop-after" : " drop-here") : "") + (dragging === p.id ? " lifting" : "")} style={{ width: w }}
                    data-pid={p.id} draggable={false}
                    onPointerDown={(e) => { if (ordering && !selecting && e.pointerType !== "touch" && e.button === 0) startMove(p.id, e.clientX, e.clientY); }} aria-label={p.name} aria-pressed={selecting ? chosen.has(p.id) : undefined}
                    onClick={(e) => { if (dragged.current) { dragged.current = false; return; } if (selecting) pick(p.id, e.shiftKey); else { setConfirmDelete(false); setInfo(false); setOpen(p.id); setBig(true); } }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="tile-text muted">{p.thumb_path ? "" : p.name}</span>}
                    {p.rating ? <span className="stars" aria-label={`${p.rating} stars`}>{p.rating}★</span> : null}
                    {ordering && <span className="seq">{sequenceOf(only).indexOf(p.id) + 1}</span>}
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
        <div className="command">
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <label htmlFor="pq" className="sr">Search your photos</label>
          <input id="pq" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your photos" autoComplete="off" spellCheck={false} />
          <span className="count">{busy ? `Uploading ${Math.min(busy.done + 1, busy.total)} of ${busy.total}` : reading > 0 ? `Reading ${reading}` : !loaded ? "" : showing === pool ? `${pool} ${pool === 1 ? "photo" : "photos"}${inArchive ? " archived" : ""}` : showing === 0 ? "No match" : `${showing} of ${pool}`}</span>
        </div>
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
              <PlaceInput id="place" className="field" value={place} placeholder="Where were these taken? Optional"
                onText={(v) => { setPlace(v); setPlaceAt(null); }} onPick={(s) => { setPlace(s.label); setPlaceAt({ lat: s.lat, lng: s.lng }); }} />
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
          <button type="button" className={view === "grid" ? "on" : ""} onClick={() => { setView("grid"); setSpot(null); }}>Grid</button>
          <button type="button" className={view === "map" ? "on" : ""} onClick={() => { stopSelecting(); setView("map"); }}>Map</button>
        </div>
        <div className="bar" style={{ display: view === "map" ? "none" : undefined }}>
          <button type="button" className={group === "date" ? "on" : ""} onClick={() => setGroup("date")}>Date</button>
          <button type="button" className={group === "place" ? "on" : ""} onClick={() => setGroup("place")}>Place</button>
          <button type="button" className={group === "subject" ? "on" : ""} onClick={() => setGroup("subject")}>Subject</button>
          <button type="button" className={group === "project" ? "on" : ""} onClick={() => setGroup("project")}>Project</button>
          {only && <button type="button" className={group === "order" ? "on" : ""} onClick={() => setGroup("order")}>Order</button>}
        </div>
        {(archivedCount > 0 || inArchive) && (
          <div className="bar">
            <button type="button" className={inArchive ? "on" : ""} onClick={() => { stopSelecting(); setOpen(null); setBig(false); setSpot(null); setInArchive((x) => !x); }}>Archive {archivedCount}</button>
          </div>
        )}
        {projects.length > 0 && (
          <div className="bar">
            <label htmlFor="only" className="sr">Show one project</label>
            <select id="only" className={"pick" + (only ? " on" : "")} value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        <div className="bar">
          {[0, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={stars === n ? "on" : ""} onClick={() => setStars(n)}>{n === 0 ? "Any rating" : n === 5 ? "5★" : `${n}★ and up`}</button>
          ))}
        </div>
        <div className="bar" style={{ display: view === "map" ? "none" : undefined }}>
          <button type="button" disabled={showing === 0 || sheet} onClick={() => setSheet(true)}>Contact sheet</button>
          <button type="button" disabled={showing === 0 || !!busy} onClick={() => exportPhotos(sequence, only || (inArchive ? "Archive" : "Stash Photos"), ordering)}>Export</button>
        </div>
        <div className="bar" style={{ display: view === "map" ? "none" : undefined }}>
          <button type="button" className={selecting ? "on" : ""} onClick={() => { if (selecting) stopSelecting(); else { setOpen(null); setSelecting(true); } }}>{selecting ? "Done selecting" : "Select"}</button>
        </div>
      </footer>

      {big && opened && (
        <BigView key={opened.id} name={opened.name} info={info} rating={opened.rating} fetching={fetching}
          src={originals[opened.id] || (opened.view_path ? views[opened.view_path] : undefined) || (opened.thumb_path ? urls[opened.thumb_path] : undefined)}
          place={`${at + 1} of ${sequence.length}`}
          note={originals[opened.id] ? "original" : opened.view_path ? "" : "small preview"}
          canLoad={!originals[opened.id] && !!opened.drive_id}
          onStep={step} onClose={closeBig} onInfo={toggleInfo} onRate={rate} onLoad={() => loadOriginal(opened)}
          archived={opened.archived} onArchive={() => setArchived([opened.id], !opened.archived)} />
      )}

      {busy && <UploadBar u={busy} onStop={() => {
        if (exporting.current) { exporting.current.abort(); return; }
        halt.current = true;
        setBusy((u) => u && { ...u, stopping: true });
      }} />}

      {waiting && !busy && (
        <section className="answer" aria-live="polite">
          <p>Google Drive needs {connected ? "reconnecting" : "connecting"}. {waiting.length} {waiting.length === 1 ? "photo is" : "photos are"} waiting to upload.</p>
          <button type="button" className="ink" onClick={async () => {
            if (!(await connectDrive(true))) { say("Google Drive was not connected."); return; }
            const rest = waiting;
            setWaiting(null);
            setConnected(true);
            deposit(rest);
          }}>Connect and carry on</button>
          <button type="button" className="pill-btn" onClick={() => setWaiting(null)}>Forget these photos</button>
        </section>
      )}

      {opened && (!big || info) && (
        <aside className={"detail" + (big ? " over" : "")} aria-label="Photo details">
          <button type="button" className="pill-btn close" onClick={() => (big ? setInfo(false) : setOpen(null))}>Close</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {opened.thumb_path && urls[opened.thumb_path] && <img src={urls[opened.thumb_path]} alt={opened.name} />}
          <h2>{opened.name}</h2>
          {opened.drive_link && <a className="pill-btn link" href={opened.drive_link} target="_blank" rel="noreferrer">Open the original in Drive</a>}
          {opened.caption && <p>{opened.caption}</p>}
          {/* Stars: click one to rate, click the same one again to clear. */}
          <div className="rate" role="group" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={(opened.rating || 0) >= n ? "on" : ""} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} onClick={() => edit(opened, { rating: opened.rating === n ? null : n })}>★</button>
            ))}
          </div>
          <dl>
            <Field key={opened.id + "s" + (opened.subject || "")} label="Subject" value={opened.subject || ""} placeholder={opened.tagged ? "Add a subject" : "Not read yet"} onSave={(v) => edit(opened, { subject: v || null })} />
            <Field key={opened.id + "d"} label="Taken" type="date" value={day(opened.taken_at)} placeholder="Add a date" onSave={(v) => {
              // Keep the time of day the camera recorded; a typed date with no time sits at midday.
              const old = opened.taken_at ? new Date(opened.taken_at) : null;
              const at = v ? new Date(`${v}T${old ? `${pad(old.getHours())}:${pad(old.getMinutes())}:${pad(old.getSeconds())}` : "12:00:00"}`) : null;
              edit(opened, { taken_at: at && !isNaN(at.getTime()) ? at.toISOString() : null });
            }} />
            {opened.taken_at && <div><dt>Time</dt><dd>{new Date(opened.taken_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</dd></div>}
            <div>
              <dt>Place</dt>
              <dd className="grow">
                <PlaceInput key={opened.id + (opened.place || "")} className="inline" value={opened.place || ""} placeholder="Add a place"
                  onText={(v) => edit(opened, { place: v || null })} onPick={(s) => edit(opened, { place: s.label, lat: s.lat, lng: s.lng })} />
              </dd>
            </div>
            {opened.lat !== null && opened.lng !== null && <div><dt>Position</dt><dd><a href={`https://www.google.com/maps?q=${opened.lat},${opened.lng}`} target="_blank" rel="noreferrer">{opened.lat.toFixed(4)}, {opened.lng.toFixed(4)}</a></dd></div>}
            <Field key={opened.id + "c"} label="Camera" value={opened.camera || ""} placeholder="Add a camera" onSave={(v) => edit(opened, { camera: v || null })} />
            <Field key={opened.id + "l"} label="Lens" value={opened.lens || ""} placeholder="Add a lens" onSave={(v) => edit(opened, { lens: v || null })} />
            <Field key={opened.id + "f"} label="Film" value={opened.film || ""} placeholder="Add a film stock" onSave={(v) => edit(opened, { film: v || null })} />
            {opened.settings && <div><dt>Settings</dt><dd>{opened.settings}</dd></div>}
            {opened.drive_folder && <div><dt>In Drive</dt><dd>{opened.drive_folder}</dd></div>}
          </dl>
          <PinMap key={opened.id + String(opened.lat) + String(opened.lng)} lat={opened.lat} lng={opened.lng} onPick={async (lat, lng) => {
            // A pin dropped on a photo with no place name fills the name in from the map.
            await edit(opened, { lat, lng, ...(opened.place ? {} : { place: await nameOf(lat, lng) }) });
          }} />
          <div className="projects">
            <p className="meta">Projects</p>
            <div className="tags">
              {opened.projects.map((p) => (
                <button key={p} type="button" className="pill-btn" aria-label={`Take out of ${p}`} onClick={() => setProject([opened.id], p, false)}>{p} <span aria-hidden="true">×</span></button>
              ))}
            </div>
            <dl><Field key={opened.id + "pj" + round} label="Add to" value="" list="project-names" placeholder="A project name" onSave={(v) => setProject([opened.id], v, true)} /></dl>
          </div>
          {opened.tags.length > 0 && <div className="tags">{opened.tags.map((t) => <button key={t} type="button" className="pill-btn" onClick={() => { setQ(t); setOpen(null); }}>{t}</button>)}</div>}
          {opened.keywords.length > 0 && <div className="tags">{opened.keywords.map((k) => <span key={k} className="pill-btn link">{k}</span>)}</div>}
          {ordering && opened.projects.includes(only) && (
            <div className="tags">
              <button type="button" className="pill-btn" onClick={() => nudge(opened.id, -1)}>Move earlier</button>
              <button type="button" className="pill-btn" onClick={() => nudge(opened.id, 1)}>Move later</button>
              <span className="meta" style={{ alignSelf: "center" }}>Number {sequenceOf(only).indexOf(opened.id) + 1} in {only}</span>
            </div>
          )}
          <button type="button" className="pill-btn" onClick={() => setArchived([opened.id], !opened.archived)}>{opened.archived ? "Restore from the archive" : "Archive"}</button>
          {confirmDelete
            ? <button type="button" className="ink" onClick={() => remove(opened)}>Confirm remove</button>
            : <button type="button" className="pill-btn" onClick={() => setConfirmDelete(true)}>Remove from Stash</button>}
          <p className="meta">Removing takes the photo out of Stash only. The original stays in your Drive.</p>
        </aside>
      )}

      {selecting && (
        <aside className="detail tray" aria-label="Selected photos">
          <button type="button" className="pill-btn close" onClick={stopSelecting}>Done</button>
          <h2>{chosen.size} {chosen.size === 1 ? "photo" : "photos"} selected</h2>
          {chosen.size === 0 ? (
            <p className="meta">Tap photos to select them. Hold Shift and click to select a run. Use Select these, beside a heading, for a whole group.</p>
          ) : (
            <>
              <p className="meta">Whatever you enter here is set on all of them. Boxes you leave empty change nothing.</p>
              <dl>
                <div>
                  <dt>Place</dt>
                  <dd className="grow">
                    <PlaceInput key={"many" + round} className="inline" value="" placeholder="Set a place"
                      onText={(v) => { if (v) editMany({ place: v }); }} onPick={(s) => editMany({ place: s.label, lat: s.lat, lng: s.lng })} />
                  </dd>
                </div>
                <Field key={"mc" + round} label="Camera" value="" placeholder="Set a camera" onSave={(v) => { if (v) editMany({ camera: v }); }} />
                <Field key={"ml" + round} label="Lens" value="" placeholder="Set a lens" onSave={(v) => { if (v) editMany({ lens: v }); }} />
                <Field key={"mf" + round} label="Film" value="" placeholder="Set a film stock" onSave={(v) => { if (v) editMany({ film: v }); }} />
                <Field key={"ms" + round} label="Subject" value="" placeholder="Set a subject" onSave={(v) => { if (v) editMany({ subject: v }); }} />
                <Field key={"mp" + round} label="Add to project" value="" list="project-names" placeholder="A project name" onSave={(v) => setProject([...chosen], v, true)} />
                <Field key={"mq" + round} label="Take out of" value="" list="project-names" placeholder="A project name" onSave={(v) => setProject([...chosen], v, false)} />
              </dl>
              <button type="button" className="pill-btn" disabled={!!busy} onClick={() => exportPhotos(sequence.filter((id) => chosen.has(id)), only || "Stash Photos selection", false)}>Export these originals</button>
              <button type="button" className="pill-btn" onClick={() => setArchived([...chosen], !inArchive)}>{inArchive ? "Restore these" : "Archive these"}</button>
              <button type="button" className="pill-btn" onClick={() => setChosen(new Set())}>Clear selection</button>
            </>
          )}
        </aside>
      )}

      {spot && !opened && (
        <aside className="detail" aria-label="Photos at this place">
          <button type="button" className="pill-btn close" onClick={() => setSpot(null)}>Close</button>
          <h2>{spot.length} photos here</h2>
          <div className="pgrid">
            {spot.map((id) => {
              const p = photos.find((x) => x.id === id);
              if (!p) return null;
              const url = p.thumb_path ? urls[p.thumb_path] : undefined;
              return (
                <button key={id} type="button" className="ptile small" aria-label={p.name} onClick={() => { setConfirmDelete(false); setOpen(id); }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url ? <img src={url} alt="" loading="lazy" /> : <span className="tile-text muted">{p.name}</span>}
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {sheet && (
        <ContactSheet onDone={closeSheet}
          title={only || (inArchive ? "Archive" : "Stash Photos")}
          note={`${sequence.length} ${sequence.length === 1 ? "photograph" : "photographs"}${ordering ? ", in sequence" : ""}${stars ? `, ${stars} stars and up` : ""}${q.trim() ? `, matching "${q.trim()}"` : ""}  ·  ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
          photos={sequence.map((id, i) => {
            const p = photos.find((x) => x.id === id)!;
            return { id, name: p.name, rating: p.rating, url: p.thumb_path ? urls[p.thumb_path] : undefined, number: ordering ? sequenceOf(only).indexOf(id) + 1 : i + 1 };
          })} />
      )}

      <datalist id="project-names">{projects.map((p) => <option key={p} value={p} />)}</datalist>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
