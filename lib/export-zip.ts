"use client";

import { downloadZip } from "client-zip";

export type ZipItem = { name: string; modified: Date; open: () => Promise<ReadableStream<Uint8Array>> };

type SaveHandle = { createWritable: () => Promise<WritableStream<Uint8Array>> };
type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

/** Asks where to save the zip. Null when the browser has no such box (Safari, Firefox); the zip is then built in memory. Throws when Kofi cancels. */
export async function chooseZipPlace(name: string): Promise<SaveHandle | null> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (!picker) return null;
  return picker({ suggestedName: name, types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }] });
}

/** Two files with the same name would overwrite each other inside a zip, so later ones get " (2)", " (3)". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase(), c = (seen.get(k) || 0) + 1;
    seen.set(k, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf(".");
    return dot > 0 ? `${n.slice(0, dot)} (${c})${n.slice(dot)}` : `${n} (${c})`;
  });
}

/**
 * Writes the items into one zip, one after another, straight to disk where the browser allows it.
 * Each file flows from its source into the zip without being held whole in memory, so a batch of large originals is fine.
 * Photographs are already compressed, so the zip stores them as they are.
 */
export async function writeZip(items: ZipItem[], name: string, place: SaveHandle | null, signal: AbortSignal, onFile: (index: number) => void, onBytes: (sent: number) => void): Promise<void> {
  let sent = 0, told = 0;
  async function* files() {
    for (let i = 0; i < items.length; i++) {
      onFile(i);
      const count = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, out) {
          sent += chunk.byteLength;
          // Reporting every small chunk would swamp the screen; four times a second is plenty.
          if (Date.now() - told > 250) { told = Date.now(); onBytes(sent); }
          out.enqueue(chunk);
        },
      });
      yield { name: items[i].name, lastModified: items[i].modified, input: (await items[i].open()).pipeThrough(count) };
    }
    onBytes(sent);
  }
  const zip = downloadZip(files());
  if (place) {
    await zip.body!.pipeTo(await place.createWritable(), { signal });
    return;
  }
  const blob = await zip.blob();
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
