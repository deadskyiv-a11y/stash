"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { api, supabase } from "@/lib/supabase-browser";
import { SAVE_COLUMNS, type Kind, type Save } from "@/lib/types";
import { pdfCover } from "@/lib/pdf-cover";
import { clusterOf, computeLayout, isQuote, samePage, type Label } from "@/lib/layout";
import { Canvas, type CanvasHandle } from "./Canvas";
import { Logo } from "./Logo";
import { Photos } from "./Photos";
import Link from "next/link";
import { useRouter } from "next/navigation";

const NAME = process.env.NEXT_PUBLIC_APP_NAME || "Stash";
type TypeFilter = "all" | Kind;

function when(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return "1 month ago";
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return "Over a year ago";
}

function looksLikeUrl(t: string): string | null {
  const s = t.trim();
  if (/\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) return "https://" + s;
  return null;
}

/** Plays a stored voice note. The file is private, so it needs a short-lived address first. */
function Player({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    supabase().storage.from("saves").createSignedUrl(path, 3600).then(({ data }) => setSrc(data?.signedUrl || ""));
  }, [path]);
  return src ? <audio controls src={src} style={{ width: "100%" }} /> : null;
}

function SignIn() {
  const [email, setEmail] = useState("");
  // A used or expired email link comes back as #error_description=... ; show it rather than a silent form.
  const [linkError] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("error_description"));
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(linkError ? "error" : "idle");
  const [msg, setMsg] = useState(linkError ? linkError + ". Send a new one." : "");
  const [code, setCode] = useState("");
  return (
    <main className="signin">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setState("sending");
          const { error } = await supabase().auth.signInWithOtp({
            email: email.trim(),
            options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
          });
          if (error) {
            setState("error");
            setMsg(/rate limit/i.test(error.message) ? "Too many sign-in emails in the last hour. Try again in an hour." : error.message);
          } else { setMsg(""); setState("sent"); }
        }}
      >
        <h1><Logo height={44} title={NAME} /></h1>
        {state === "sent" ? (
          <>
            {/* A link works once, in whichever browser opens it first. The code works anywhere. */}
            <p>Check your email. Type the 6-digit code here, or open the link once.</p>
            <input aria-label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
            <button type="button" className="ink" disabled={code.length < 6} onClick={async () => {
              const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
              if (error) setMsg("That code did not work. It may be used or out of date.");
            }}>Sign in</button>
            {msg && <p className="error">{msg}</p>}
          </>
        ) : (
          <>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button type="submit" className="ink" disabled={state === "sending"}>{state === "sending" ? "Sending" : "Send sign-in link"}</button>
            {state === "error" && <p className="error">{msg}</p>}
          </>
        )}
      </form>
    </main>
  );
}

export default function App({ room = "stash" }: { room?: "stash" | "photos" }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return null;
  if (!session) return <SignIn />;
  return room === "photos" ? <Photos /> : <Library />;
}

function Library() {
  const router = useRouter();
  const [saves, setSaves] = useState<Save[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [recent, setRecent] = useState(false);
  const [pick, setPick] = useState<{ cluster: string; sub: string | null } | null>(null);
  const [found, setFound] = useState<{ q: string; ids: Set<string> } | null>(null);
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [zoom, setZoom] = useState(100);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reply, setReply] = useState<{ q: string; text: string; sources: string[] } | null>(null);
  const [moving, setMoving] = useState<{ id: string; to: string } | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const box = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const picFile = useRef<HTMLInputElement>(null);
  const signed = useRef(new Set<string>());
  const [now] = useState(() => Date.now());

  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(""), 4000); }, []);

  // Load everything once.
  useEffect(() => {
    (async () => {
      // The database hands back at most 1,000 rows a time, so keep asking until a short page comes back.
      const all: Save[] = [];
      let failed = "";
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase().from("saves").select(SAVE_COLUMNS)
          .order("created_at", { ascending: false }).order("id").range(from, from + 999);
        if (error) { failed = error.message; break; }
        all.push(...((data as unknown as Save[]) || []));
        if (!data || data.length < 1000) break;
      }
      // A save still marked as being read long after it was made was cut short. Show it as it is, not as "Reading" for ever.
      const old = Date.now() - 10 * 60 * 1000;
      setSaves(all.map((s) => (s.status === "processing" && new Date(s.created_at).getTime() < old ? { ...s, status: "failed" } : s)));
      setLoadError(failed);
      setLoaded(true);
    })();
  }, []);

  // Private images need a short-lived signed address each.
  useEffect(() => {
    const need = saves.map((s) => s.image_path).filter((p): p is string => !!p && !signed.current.has(p));
    if (need.length === 0) return;
    need.forEach((p) => signed.current.add(p));
    (async () => {
      for (let i = 0; i < need.length; i += 100) {
        const { data } = await supabase().storage.from("saves").createSignedUrls(need.slice(i, i + 100), 60 * 60 * 12);
        if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string])) }));
      }
    })();
  }, [saves]);

  // Search by meaning on the server, a moment after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const t = window.setTimeout(async () => {
      try {
        const r = await api<{ results: { id: string }[] }>("/api/search", { q: term });
        setFound({ q: term, ids: new Set(r.results.map((x) => x.id)) });
      } catch { /* word matching below still works */ }
    }, 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const layout = useMemo(() => computeLayout(saves), [saves]);

  const hits = useMemo<Set<string> | null>(() => {
    const term = q.trim().toLowerCase();
    const tokens = term.split(/\s+/).filter(Boolean);
    const filtering = tokens.length > 0 || type !== "all" || recent || pick !== null;
    if (!filtering) return null;
    const semantic = found && found.q.toLowerCase() === term ? found.ids : null;
    const cutoff = now - 30 * 86400000;
    const out = new Set<string>();
    for (const s of saves) {
      if (type !== "all" && s.kind !== type) continue;
      if (recent && new Date(s.created_at).getTime() < cutoff) continue;
      if (pick && (clusterOf(s) !== pick.cluster || (pick.sub !== null && (s.subgroup || "") !== pick.sub))) continue;
      if (tokens.length) {
        const hay = [s.title, s.summary, s.note, s.site, s.cluster, s.subgroup, s.kind, s.tags.join(" "), s.facts.map((f) => f.label + " " + f.value).join(" ")].join(" ").toLowerCase();
        const words = tokens.every((t) => hay.includes(t));
        if (!words && !(semantic && semantic.has(s.id))) continue;
      }
      out.add(s.id);
    }
    return out;
  }, [saves, q, type, recent, pick, found, now]);

  const focusKey = hits === null ? "all" : [...hits].sort().join(",") || "none:" + q;
  const shown = useMemo(() => (hits === null ? saves : saves.filter((s) => hits.has(s.id))), [saves, hits]);
  const opened = open ? saves.find((s) => s.id === open) || null : null;

  const add = useCallback(async (body: { kind: "link"; url: string; image?: string } | { kind: "note"; text: string; url?: string; from?: string } | { kind: "image" | "file" | "voice"; path: string; name: string; cover?: string }, label: string) => {
    const tempId = "temp-" + crypto.randomUUID();
    const temp: Save = {
      id: tempId, kind: body.kind === "voice" ? "note" : body.kind, status: "processing", url: body.kind === "link" ? body.url : null, site: null, title: label, summary: null,
      note: body.kind === "note" ? body.text : null, tags: [], cluster: null, subgroup: null, facts: [], image_path: null, file_path: null, image_w: null, image_h: null,
      is_pale: false, pinned: false, form: null, excerpt: null, recipe: null, created_at: new Date().toISOString(),
    };
    setSaves((s) => [temp, ...s]);
    try {
      const r = await api<{ save: Save }>("/api/saves", body);
      // Same tile, new id: it travels from the Inbox to its group instead of blinking out and in.
      setSaves((s) => s.map((x) => (x.id === tempId ? { ...r.save, _key: tempId } : x)));
    } catch (e) {
      setSaves((s) => s.filter((x) => x.id !== tempId));
      say(e instanceof Error ? e.message : "Could not save");
    }
  }, [say]);

  const addText = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const url = looksLikeUrl(t);
    if (url) add({ kind: "link", url }, url);
    else add({ kind: "note", text: t }, t.slice(0, 60));
  }, [add]);

  // The share key. Stash saves a link handed to it in the address only when the address also carries this
  // private key, which the bookmark button, the Arc extension and the iPhone Shortcut each hold. Without it,
  // any web page could make the owner's browser save things. The key lives on the account, so every device has it.
  const [saveKey, setSaveKey] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase().auth.getUser();
      let key = typeof data.user?.user_metadata?.save_key === "string" ? (data.user.user_metadata.save_key as string) : "";
      if (data.user && key.length < 20) {
        key = crypto.randomUUID().replace(/-/g, "");
        await supabase().auth.updateUser({ data: { save_key: key } });
      }
      setSaveKey(key);
      // The extension reads this once, the first time it is used, so it never has to be typed in.
      document.documentElement.dataset.sk = key;
    })();
  }, []);

  // Something handed over in the address: /#save=<link>&k=<key>, with an optional picture, quote and page title.
  type Incoming = { link: string; img: string | null; quote: string; from?: string; k: string };
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [asking, setAsking] = useState<Incoming | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const link = params.get("save");
    if (!link) return;
    history.replaceState(null, "", window.location.pathname);
    queueMicrotask(() => setIncoming({ link, img: params.get("img"), quote: (params.get("q") || "").trim(), from: params.get("t") || undefined, k: params.get("k") || "" }));
  }, []);

  const takeIn = useCallback((x: Incoming) => {
    const url = looksLikeUrl(x.link.trim());
    // Highlighted text arrives as a quote that remembers its page. Otherwise it is the page itself.
    if (url && x.quote) add({ kind: "note", text: x.quote, url, from: x.from }, x.quote.slice(0, 60));
    else if (url && x.img) add({ kind: "link", url, image: x.img }, url);
    else addText(x.link);
  }, [add, addText]);

  useEffect(() => {
    if (!incoming || !saveKey) return;
    const x = incoming;
    queueMicrotask(() => {
      setIncoming(null);
      // The right key: save without a word. No key, or a wrong one: ask first.
      if (x.k === saveKey) takeIn(x); else setAsking(x);
    });
  }, [incoming, saveKey, takeIn]);

  const addFiles = useCallback(async (files: File[]) => {
    const { data } = await supabase().auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    for (const f of files) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isAudio = f.type.startsWith("audio/") || /\.(m4a|mp3|wav|ogg)$/i.test(f.name);
      if (!f.type.startsWith("image/") && !isPdf && !isAudio) { say("Only images, PDFs and voice recordings can be saved for now."); continue; }
      if (f.size > 20 * 1024 * 1024) { say("That file is over 20 MB."); continue; }
      const path = `${uid}/upload-${crypto.randomUUID()}`;
      const { error } = await supabase().storage.from("saves").upload(path, f, { contentType: isPdf ? "application/pdf" : f.type });
      if (error) { say("Upload failed. " + error.message); continue; }
      // A PDF's tile shows its first page, drawn here in the browser. Without it the save still works.
      let cover: string | undefined;
      const page1 = isPdf ? await pdfCover(f) : null;
      if (page1) {
        cover = `${uid}/upload-${crypto.randomUUID()}`;
        const up = await supabase().storage.from("saves").upload(cover, page1, { contentType: "image/jpeg" });
        if (up.error) cover = undefined;
      }
      add({ kind: isPdf ? "file" : isAudio ? "voice" : "image", cover, path, name: isAudio ? f.name : f.name.replace(/\.[^.]+$/, "") }, f.name);
    }
  }, [add, say]);

  // A link whose site would not hand over a picture takes one from Kofi: paste, drop or choose while it is open.
  const pictureFor = opened && (opened.kind === "link" || opened.kind === "file") && !opened.id.startsWith("temp-") ? opened.id : null;
  const givePicture = useCallback(async (id: string, f: File) => {
    if (!f.type.startsWith("image/")) { say("That is not a picture."); return; }
    if (f.size > 20 * 1024 * 1024) { say("That image is over 20 MB."); return; }
    const { data } = await supabase().auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    setToast("Reading the picture");
    const path = `${uid}/upload-${crypto.randomUUID()}`;
    const { error } = await supabase().storage.from("saves").upload(path, f, { contentType: f.type });
    if (error) { say("Upload failed. " + error.message); return; }
    try {
      const r = await api<{ save: Save }>("/api/saves", { kind: "picture", id, path });
      const p = r.save.image_path;
      // The picture may reuse the old file name, so sign it afresh rather than show the cached old one.
      if (p) { signed.current.delete(p); setUrls((u) => { const n = { ...u }; delete n[p]; return n; }); }
      setSaves((s) => s.map((x) => (x.id === id ? r.save : x)));
      say("Picture added");
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not add the picture");
    }
  }, [say]);

  // Voice note: record in the browser, then save the recording like any other file.
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const record = async () => {
    if (recorder.current) { recorder.current.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Safari records mp4, Chrome records webm. Both are accepted for transcription.
      const type = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: type });
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setRecording(false);
        setAdding(false);
        if (parts.length) addFiles([new File(parts, type === "audio/mp4" ? "Voice note.m4a" : "Voice note.webm", { type })]);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      say("Could not use the microphone. Allow it when the browser asks.");
    }
  };

  // The phone has no Cmd+V, so a button reads the clipboard: a picture if there is one, else the text.
  const pasteClip = async () => {
    try {
      for (const it of await navigator.clipboard.read()) {
        const img = it.types.find((t) => t.startsWith("image/"));
        if (img) { addFiles([new File([await it.getType(img)], "Pasted image", { type: img })]); return; }
        if (it.types.includes("text/plain")) { addText(await (await it.getType("text/plain")).text()); return; }
      }
      say("Nothing to paste.");
    } catch {
      say("Could not read the clipboard. Tap Paste when the phone asks.");
    }
  };

  // Paste anywhere, drop anywhere, Cmd+K for the box, Esc to clear.
  useEffect(() => {
    const typing = () => { const a = document.activeElement; return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement; };
    const onPaste = (e: ClipboardEvent) => {
      if (typing()) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); if (pictureFor) givePicture(pictureFor, files[0]); else addFiles(files); return; }
      const text = e.clipboardData?.getData("text/plain");
      if (text) { e.preventDefault(); addText(text); }
    };
    const onKey = (e: KeyboardEvent) => {
      // Option+P switches between Stash and the photo room.
      if (e.altKey && e.code === "KeyP") { e.preventDefault(); router.push("/photos"); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box.current?.focus(); box.current?.select(); }
      if (e.key === "Escape") { setOpen(null); setAdding(false); setMenu(false); setReply(null); if (document.activeElement === box.current) { setQ(""); setPick(null); } }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) { if (pictureFor) givePicture(pictureFor, files[0]); else addFiles(files); return; }
      const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
      if (text) addText(text.split("\n")[0]);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles, addText, pictureFor, givePicture, router]);

  const remove = async (s: Save) => {
    const { error } = await supabase().from("saves").delete().eq("id", s.id);
    if (error) { say("Could not delete. " + error.message); return; }
    const stored = [s.image_path, s.file_path].filter((x): x is string => !!x);
    if (stored.length) await supabase().storage.from("saves").remove(stored);
    setSaves((all) => all.filter((x) => x.id !== s.id));
    setOpen(null);
  };

  const pin = async (s: Save) => {
    const { error } = await supabase().from("saves").update({ pinned: !s.pinned }).eq("id", s.id);
    if (error) { say("Could not change the pin. " + error.message); return; }
    setSaves((all) => all.map((x) => (x.id === s.id ? { ...x, pinned: !s.pinned } : x)));
  };

  const [tidying, setTidying] = useState(false);
  const tidyUp = async () => {
    setTidying(true);
    setToast("Tidying");
    try {
      const r = await api<{ saves: Save[] }>("/api/tidy", {});
      const byId = new Map(r.saves.map((s) => [s.id, s]));
      setSaves((all) => all.map((x) => (byId.has(x.id) ? { ...byId.get(x.id)!, _key: x._key } : x)));
      say(r.saves.length === 0 ? "Already tidy. Nothing moved." : `Tidied. ${r.saves.length} ${r.saves.length === 1 ? "save" : "saves"} moved.`);
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not tidy");
    }
    setTidying(false);
  };

  // A question typed in the box gets a written answer on Enter, with the saves it came from.
  const ask = async () => {
    const term = q.trim();
    if (!/\?$|^(who|what|when|where|which|why|how|did|do|does|is|are|was|were|can|have|has)\b/i.test(term)) return;
    setReply({ q: term, text: "", sources: [] });
    try {
      const r = await api<{ answer: string; sources: string[] }>("/api/answer", { q: term });
      setReply((cur) => (cur && cur.q === term ? { q: term, text: r.answer, sources: r.sources } : cur));
      // Fly the canvas to the saves the answer rests on.
      if (r.sources.length) setFound({ q: term, ids: new Set(r.sources) });
    } catch (e) {
      setReply((cur) => (cur && cur.q === term ? { q: term, text: e instanceof Error ? e.message : "Could not answer just now.", sources: [] } : cur));
    }
  };

  // For a save made before recipes existed, or one the AI did not spot as cooking.
  const [cooking, setCooking] = useState(false);
  const getRecipe = async (s: Save) => {
    setCooking(true);
    setToast("Writing out the recipe");
    try {
      const r = await api<{ save: Save }>("/api/saves", { kind: "recipe", id: s.id });
      setSaves((all) => all.map((x) => (x.id === s.id ? { ...r.save, _key: x._key } : x)));
      say("Recipe added");
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not work out the recipe");
    }
    setCooking(false);
  };

  const reset = () => { setQ(""); setType("all"); setRecent(false); setPick(null); canvas.current?.refit(); };
  const filtering = hits !== null;
  const status = !loaded ? "" : !filtering ? `${saves.length} ${saves.length === 1 ? "save" : "saves"}` : hits!.size === 0 ? "No match" : `${hits!.size} of ${saves.length}`;
  const types: [TypeFilter, string][] = [["all", "Everything"], ["image", "Images"], ["link", "Links"], ["note", "Notes"]];

  return (
    <main className="app">
      {view === "canvas" ? (
        <Canvas ref={canvas} saves={saves} layout={layout} hits={hits} urls={urls} focusKey={focusKey}
          onOpen={(id) => { setConfirmDelete(false); setOpen(id); }}
          onPick={(l: Label) => { setQ(""); setPick((p) => (p && p.cluster === l.cluster && p.sub === l.sub ? null : { cluster: l.cluster, sub: l.sub })); }}
          onZoom={setZoom} />
      ) : (
        <div className="list">
          <div className="list-inner">
            <div className="list-note">Newest first. {shown.length} {shown.length === 1 ? "save" : "saves"}.</div>
            {shown.slice(0, 500).map((s) => (
              <button key={s.id} type="button" className="row" onClick={() => { setConfirmDelete(false); setOpen(s.id); }}>
                <span className={"thumb " + s.kind + (isQuote(s) ? " quote" : "") + (s.is_pale ? " pale" : "")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.image_path && urls[s.image_path] ? <img src={urls[s.image_path]} alt="" loading="lazy" /> : null}
                </span>
                <span className="row-main">
                  <span className="row-title">{s.title || s.url || "Untitled"}</span>
                  <span className="row-path">{[clusterOf(s), s.subgroup].filter(Boolean).join(" / ")}{s.site ? "  ·  " + s.site : ""}</span>
                </span>
                <span className="row-kind">{s.kind === "image" ? "Image" : s.kind === "link" ? "Link" : isQuote(s) ? "Quote" : s.form === "recipe" ? "Recipe" : s.form === "voice" ? "Voice" : s.kind === "note" ? "Note" : "PDF"}</span>
                <span className="row-when">{when(s.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loaded && loadError && (
        <div className="empty">
          <h2>Could not load your saves</h2>
          <p>{loadError}. Reload the page to try again.</p>
        </div>
      )}

      {loaded && !loadError && saves.length === 0 && (
        <div className="empty">
          <h2>Nothing saved yet</h2>
          <p>Paste a link, drop an image or PDF, record a voice note, or press Save.</p>
        </div>
      )}

      <header className="top">
        <div className="brand">
          <button type="button" className="plain" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={NAME + " menu"}><Logo height={24} title={NAME} /></button>
          <span className="pill-btn link on desk" aria-current="page">Stash</span>
          <Link className="pill-btn link desk" href="/photos">Photos</Link>
          {menu && <Link className="pill-btn link phone-only" href="/photos">Photos</Link>}
          {menu && <button type="button" className="pill-btn" onClick={() => supabase().auth.signOut()}>Sign out</button>}
          {/* The browser button: dragged to the bookmarks bar, it sends the page being viewed, and its picture, to Stash. */}
          {menu && saveKey && <button type="button" className="pill-btn" onClick={() => navigator.clipboard.writeText(saveKey).then(() => say("Share key copied."), () => say("Could not copy. " + saveKey))}>Copy share key</button>}
          {menu && saveKey && (
            <a className="pill-btn bookmarklet" title="Drag this to your bookmarks bar" draggable
              ref={(el) => { el?.setAttribute("href", `javascript:(()=>{const q=s=>document.querySelector(s);const s=String(getSelection()).trim().slice(0,4000);const i=(q('meta[property="og:image"]')||{}).content||(q('video[poster]')||{}).poster||'';window.open('${window.location.origin}/#k=${saveKey}&save='+encodeURIComponent(location.href)+(i?'&img='+encodeURIComponent(i):'')+(s?'&q='+encodeURIComponent(s)+'&t='+encodeURIComponent(document.title.slice(0,200)):''),'_blank')})()`); }}
              onClick={(e) => { e.preventDefault(); say("Drag this button onto your bookmarks bar."); }}>Save to Stash</a>
          )}
        </div>
        <div className="command">
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <label htmlFor="q" className="sr">Search your saves</label>
          <input id="q" ref={box} type="text" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); setReply(null); }} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder="Search, or ask a question" autoComplete="off" spellCheck={false} />
          <span className="count">{status}</span>
        </div>
        <button type="button" className="pill-btn phone" onClick={pasteClip}>Paste</button>
        <button type="button" className="ink phone" onClick={() => setAdding((a) => !a)}>New note</button>
        <button type="button" className="ink save" onClick={() => setAdding((a) => !a)}>Save</button>
      </header>

      {reply && (
        <section className="answer" aria-live="polite" aria-label="Answer">
          <p className={reply.text ? "" : "muted"}>{reply.text || "Reading your saves"}</p>
          {reply.sources.map((id) => {
            const s = saves.find((x) => x.id === id);
            return s ? <button key={id} type="button" className="pill-btn" onClick={() => { setConfirmDelete(false); setOpen(id); }}>{s.title || s.site || "Untitled"}</button> : null;
          })}
        </section>
      )}

      {asking && (
        <section className="answer" aria-live="polite" aria-label="Save this?">
          <p>Something asked Stash to save this. It did not come from your own share button.</p>
          <p className="meta" style={{ overflowWrap: "anywhere" }}>{asking.quote ? "\u201C" + asking.quote.slice(0, 200) + "\u201D  ·  " : ""}{asking.link.slice(0, 200)}</p>
          <div className="adder-actions" style={{ width: "100%" }}>
            <button type="button" className="pill-btn" onClick={() => setAsking(null)}>Ignore</button>
            <button type="button" className="ink" onClick={() => { const x = asking; setAsking(null); takeIn(x); }}>Save it</button>
          </div>
        </section>
      )}

      {adding && (
        <form className="adder" onSubmit={(e) => { e.preventDefault(); addText(draft); setDraft(""); setAdding(false); }}>
          <label htmlFor="draft" className="sr">Link or note</label>
          <textarea id="draft" autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste a link or write a note"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
          <div className="adder-actions">
            <button type="button" className="pill-btn" onClick={() => file.current?.click()}>Choose a file</button>
            <button type="button" className={recording ? "ink" : "pill-btn"} onClick={record}>{recording ? "Stop and save" : "Record"}</button>
            <button type="submit" className="ink">Save</button>
          </div>
          <input ref={file} type="file" accept="image/*,application/pdf,audio/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = ""; setAdding(false); }} />
        </form>
      )}

      <footer className={"bottom" + (opened ? " with-panel" : "")}>
        <div className="bar">
          <button type="button" className={view === "canvas" ? "on" : ""} onClick={() => setView("canvas")}>Canvas</button>
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
        </div>
        <div className="bar">
          {types.map(([t, label]) => (
            <button key={t} type="button" className={type === t ? "on" : ""} onClick={() => setType(t)}>{label}</button>
          ))}
          <button type="button" className={recent ? "on" : ""} onClick={() => setRecent((r) => !r)}>Last 30 days</button>
        </div>
        <div className="bar" style={{ visibility: view === "canvas" ? "visible" : "hidden" }}>
          <button type="button" className="round" aria-label="Zoom out" onClick={() => canvas.current?.zoomBy(1 / 1.35)}>−</button>
          <span className="zoom">{zoom}%</span>
          <button type="button" className="round" aria-label="Zoom in" onClick={() => canvas.current?.zoomBy(1.35)}>+</button>
          <button type="button" disabled={tidying} onClick={tidyUp}>Tidy</button>
          <button type="button" className="white" onClick={reset}>See all</button>
        </div>
      </footer>

      {opened && (
        <aside className="detail" aria-label="Save details">
          <button type="button" className="pill-btn close" onClick={() => setOpen(null)}>Close</button>
          {opened.image_path && urls[opened.image_path] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={opened.is_pale ? "pale" : ""} src={urls[opened.image_path]} alt={opened.title || ""} />
          )}
          <h2>{opened.title || "Untitled"}</h2>
          {opened.url && <a href={opened.url} target="_blank" rel="noreferrer">{opened.site || opened.url}</a>}
          {opened.file_path && opened.kind === "note" && <Player key={opened.file_path} path={opened.file_path} />}
          {opened.file_path && opened.kind === "file" && (
            <button type="button" className="pill-btn" onClick={async () => {
              // Open the tab first, while this is still a tap, or the browser blocks it as a pop-up.
              const w = window.open("", "_blank");
              const { data } = await supabase().storage.from("saves").createSignedUrl(opened.file_path!, 300);
              if (data?.signedUrl && w) w.location.href = data.signedUrl; else { w?.close(); say("Could not open the PDF."); }
            }}>Open PDF</button>
          )}
          {opened.summary && <p>{opened.summary}</p>}
          {opened.kind === "note" && opened.note && <p className="note-body">{isQuote(opened) ? "\u201C" + opened.note + "\u201D" : opened.note}</p>}
          {/* A quote leads back to its article, and an article lists the quotes taken from it. */}
          {isQuote(opened) && (() => {
            const from = saves.find((x) => x.kind === "link" && samePage(x.url, opened.url));
            return from ? <button type="button" className="pill-btn" onClick={() => { setConfirmDelete(false); setOpen(from.id); }}>Open the article</button> : null;
          })()}
          {opened.kind === "link" && (() => {
            const quotes = saves.filter((x) => isQuote(x) && samePage(x.url, opened.url));
            return quotes.length === 0 ? null : (
              <div className="quotes">
                <p className="meta">Quotes from this page</p>
                {quotes.map((x) => <button key={x.id} type="button" className="quote-row" onClick={() => { setConfirmDelete(false); setOpen(x.id); }}>{"\u201C" + (x.note || "") + "\u201D"}</button>)}
              </div>
            );
          })()}
          {opened.recipe && (
            <section className="recipe" aria-label="Recipe">
              <h3>{opened.recipe.dish || "Recipe"}</h3>
              <p className="meta">{[opened.recipe.serves && "Serves " + opened.recipe.serves.replace(/^serves\s*/i, ""), opened.recipe.time].filter(Boolean).join("  ·  ")}</p>
              <h4>Ingredients</h4>
              <ul>{opened.recipe.ingredients.map((i, n) => <li key={n}><span>{i.amount}</span>{i.item}</li>)}</ul>
              <h4>Method</h4>
              <ol>{opened.recipe.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
              <p className="meta">{opened.recipe.basis === "post"
                ? "Taken from what the post itself says."
                : "The post did not give the full recipe, so the AI filled in the gaps from its own knowledge of the dish. It has not watched the video. Check the amounts before you cook."}</p>
            </section>
          )}
          {!opened.recipe && !opened.id.startsWith("temp-") && /food|recipe|cook|bak|dish|meal|kitchen|cuisine/i.test([opened.title, opened.cluster, opened.subgroup, opened.tags.join(" ")].join(" ")) && (
            <button type="button" className="pill-btn" disabled={cooking} onClick={() => getRecipe(opened)}>Write out the recipe</button>
          )}
          {opened.facts.length > 0 && (
            <dl>{opened.facts.map((f, i) => (<div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>))}</dl>
          )}
          {pictureFor === opened.id && (
            <>
              {!opened.image_path && <p className="meta">No picture came with this. Paste or drop a screenshot here to use as its picture.</p>}
              <button type="button" className="pill-btn" onClick={() => picFile.current?.click()}>{opened.image_path ? "Change picture" : "Add picture"}</button>
              <input ref={picFile} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) givePicture(opened.id, f); e.target.value = ""; }} />
            </>
          )}
          {opened.tags.length > 0 && (
            <div className="tags">{opened.tags.map((t) => (<button key={t} type="button" className="pill-btn" onClick={() => { setQ(t); setPick(null); setOpen(null); }}>{t}</button>))}</div>
          )}
          <div className="meta">{[clusterOf(opened), opened.subgroup].filter(Boolean).join(" / ")}  ·  {when(opened.created_at)}</div>
          {/* Filing by hand, for a save the AI could not place or placed wrongly. */}
          {!opened.id.startsWith("temp-") && (moving?.id === opened.id ? (
            <form className="move" onSubmit={async (e) => {
              e.preventDefault();
              const to = moving.to.trim().slice(0, 40);
              if (!to) return;
              const { error } = await supabase().from("saves").update({ cluster: to, subgroup: null, pinned: true }).eq("id", opened.id);
              if (error) { say("Could not move. " + error.message); return; }
              setSaves((all) => all.map((x) => (x.id === opened.id ? { ...x, cluster: to, subgroup: null, pinned: true } : x)));
              setMoving(null);
            }}>
              <input aria-label="Group" list="groups" autoFocus value={moving.to} onChange={(e) => setMoving({ id: opened.id, to: e.target.value })} placeholder="Group name" />
              <datalist id="groups">{[...new Set(saves.map(clusterOf))].sort().map((c) => <option key={c} value={c} />)}</datalist>
              <button type="submit" className="ink">Move</button>
            </form>
          ) : (
            <button type="button" className="pill-btn" onClick={() => setMoving({ id: opened.id, to: "" })}>Move to a group</button>
          ))}
          {!opened.id.startsWith("temp-") && (
            <>
              <button type="button" className={opened.pinned ? "ink" : "pill-btn"} aria-pressed={opened.pinned} onClick={() => pin(opened)}>{opened.pinned ? "Pinned" : "Pin"}</button>
              {opened.pinned && <p className="meta">Pinned. Tidy will not move this save.</p>}
            </>
          )}
          {!opened.id.startsWith("temp-") && (
            confirmDelete
              ? <button type="button" className="ink" onClick={() => remove(opened)}>Confirm delete</button>
              : <button type="button" className="pill-btn" onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
        </aside>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
