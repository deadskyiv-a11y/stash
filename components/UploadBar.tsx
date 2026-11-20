"use client";

export type Upload = { done: number; total: number; name: string; sent: number; size: number; secs: number; stopping: boolean; verb?: string };

const mb = (n: number) => (n / 1048576 >= 100 ? Math.round(n / 1048576) : (n / 1048576).toFixed(1)) + " MB";

/** The bar shown while a batch uploads: how many are done, which file is going up, how far along, and roughly how long is left. */
export function UploadBar({ u, onStop }: { u: Upload; onStop: () => void }) {
  const part = u.size > 0 ? Math.min(1, u.sent / u.size) : 0;
  const secs = u.secs; // seconds since the batch began, as of the last progress report
  // Only guess the time left once there is something to judge the speed by.
  const left = secs > 8 && u.sent > 0 && part < 1 ? (secs * (u.size - u.sent)) / u.sent : null;
  const eta = left === null ? "" : left < 60 ? "under a minute left" : `about ${Math.round(left / 60)} min left`;
  return (
    <section className="upload" role="status" aria-live="polite">
      <div className="upload-top">
        <strong>{u.stopping ? "Stopping after this photo" : `${u.verb || "Uploading"} ${Math.min(u.done + 1, u.total)} of ${u.total}`}</strong>
        <span className="meta">{Math.round(part * 100)}%</span>
      </div>
      <div className="upload-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part * 100)}>
        <div style={{ width: `${part * 100}%` }} />
      </div>
      <div className="upload-top">
        <span className="meta name">{u.name}</span>
        <span className="meta">{mb(u.sent)} of {mb(u.size)}{eta ? "  ·  " + eta : ""}</span>
      </div>
      {!u.stopping && <button type="button" className="pill-btn" onClick={onStop}>Stop</button>}
    </section>
  );
}
