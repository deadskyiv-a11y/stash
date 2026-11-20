"use client";

import type { Save } from "@/lib/types";
import { isArticle, isQuote } from "@/lib/layout";

/** Stash on a phone: the saves in two columns, newest first. Pictures stay bare, articles keep their caption, notes stay yellow, quotes grey. */
export function Feed({ saves, urls, onOpen }: { saves: Save[]; urls: Record<string, string>; onOpen: (id: string) => void }) {
  return (
    <div className="feed">
      <div className="feed-cols">
        {saves.map((s) => {
          const url = s.image_path ? urls[s.image_path] : undefined;
          const quote = isQuote(s);
          return (
            <button key={s._key || s.id} type="button" className={"fcard" + (s.is_pale ? " pale" : "")} onClick={() => onOpen(s.id)} aria-label={s.title || "Save"}>
              {s.image_path ? (
                <>
                  {/* The picture's own shape is reserved before it loads, so the feed does not jump about. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" decoding="async" style={{ aspectRatio: s.image_w && s.image_h ? `${s.image_w} / ${s.image_h}` : undefined }} />
                  {isArticle(s) && (
                    <span className="fcap">
                      <b>{s.title}</b>
                      <span>{s.site}</span>
                    </span>
                  )}
                </>
              ) : s.status === "processing" ? (
                <span className="fbox muted">Reading</span>
              ) : quote ? (
                <span className="fbox">
                  <span className="qm" aria-hidden="true">&ldquo;</span>
                  <span className="fclamp">{s.note}</span>
                  <span className="muted">{s.site}</span>
                </span>
              ) : s.kind === "note" ? (
                <span className="fbox note">
                  <span className="fclamp">{s.note || s.title}</span>
                  {s.form === "voice" && <span className="muted">Voice note</span>}
                </span>
              ) : (
                <span className="fbox">
                  <span className="muted">{s.site || (s.kind === "file" ? "PDF" : "")}</span>
                  <span className="fclamp">{s.title}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
