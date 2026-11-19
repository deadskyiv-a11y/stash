"use client";

// Google Drive, straight from the browser. Stash asks for the narrowest permission Google offers
// ("drive.file"): it can create files and see the files it created, and nothing else in the Drive.
// ponytail: the pass lasts about an hour and lives only in this tab, so there is no secret and nothing
// stored on a server. Stash asks Google for a fresh one before a batch and when one is about to run out.
// Google only renews through a small window, which a browser may block when no click led to it; the photo
// room then pauses the batch and shows a Reconnect button. A server-side refresh token would remove even that.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const KEY = "stash-drive-token";
const FOLDER = "application/vnd.google-apps.folder";

type TokenResponse = { access_token?: string; expires_in?: number };
type Gis = { accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: () => void }): { requestAccessToken(o?: { prompt?: string }): void } } } };

let token: { value: string; exp: number } | null = null;
const folders = new Map<string, string>();

export const driveConfigured = () => CLIENT_ID !== "";

export function driveConnected(): boolean {
  if (!token && typeof sessionStorage !== "undefined") {
    try { token = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { token = null; }
  }
  return !!token && token.exp > Date.now() + 60_000;
}

function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  return new Promise((done, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => (w.google ? done(w.google) : fail(new Error("Google did not load")));
    s.onerror = () => fail(new Error("Google did not load"));
    document.head.appendChild(s);
  });
}

/** Minutes left on the current pass. Zero when there is none. */
export function driveMinutesLeft(): number {
  return driveConnected() ? Math.max(0, (token!.exp - Date.now()) / 60_000) : 0;
}

/** Opens Google's own window asking Kofi to allow Drive. With fresh set, asks for a new pass even while one is still good. Resolves false when the window was blocked or closed. */
export async function connectDrive(fresh = false): Promise<boolean> {
  if (!fresh && driveConnected()) return true;
  const google = await loadGis();
  return new Promise((done) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return done(false);
        token = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        try { sessionStorage.setItem(KEY, JSON.stringify(token)); } catch { /* private window */ }
        done(true);
      },
      error_callback: () => done(false),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

async function api(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  if (!driveConnected()) throw new Error("Google Drive is not connected.");
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token!.value}` } });
  if (res.status === 401) { token = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } throw new Error("Google Drive needs connecting again."); }
  if (!res.ok) throw new Error(`Google Drive answered with ${res.status}.`);
  return res.json();
}

/** Finds or makes a folder path such as ["Stash Photos", "2026", "2026-11"] and returns the last folder's id. */
export async function ensureFolder(path: string[]): Promise<string> {
  let parent = "root";
  let key = "";
  for (const name of path) {
    key += "/" + name;
    let id = folders.get(key);
    if (!id) {
      const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and '${parent}' in parents and trashed=false`;
      const found = await api(`https://www.googleapis.com/drive/v3/files?fields=files(id)&q=${encodeURIComponent(q)}`);
      id = (found.files as { id: string }[] | undefined)?.[0]?.id;
      if (!id) {
        const made = await api("https://www.googleapis.com/drive/v3/files?fields=id", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
        });
        id = made.id as string;
      }
      folders.set(key, id);
    }
    parent = id;
  }
  return parent;
}

/** Sends the original file to a Drive folder. The file goes from this browser to Google and nowhere else. */
export async function uploadToDrive(file: File, folderId: string): Promise<{ id: string; link: string }> {
  const b = "stash" + crypto.randomUUID();
  const head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: file.name, parents: [folderId] })}\r\n--${b}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const made = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${b}` },
    body: new Blob([head, file, `\r\n--${b}--`]),
  });
  return { id: made.id as string, link: (made.webViewLink as string) || `https://drive.google.com/file/d/${made.id}/view` };
}

/** Fetches the full original from Drive, for looking at a photograph at its real size. */
export async function downloadFromDrive(id: string): Promise<Blob> {
  if (!driveConnected()) throw new Error("Google Drive is not connected.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token!.value}` } });
  if (res.status === 401) { token = null; throw new Error("Google Drive needs connecting again."); }
  if (!res.ok) throw new Error(`Google Drive answered with ${res.status}.`);
  return res.blob();
}
