"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 640px)";

/** True on a phone-sized screen. The phone gets its own simpler layout, not the desktop one squeezed down. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", changed);
      return () => m.removeEventListener("change", changed);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
