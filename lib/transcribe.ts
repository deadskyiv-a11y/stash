const TYPES: Record<string, string> = {
  m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg", mpga: "audio/mpeg", mpeg: "audio/mpeg", wav: "audio/wav", webm: "audio/webm", ogg: "audio/ogg",
};

/** The file ending of a recording, limited to the kinds the transcription service accepts. */
export function audioExt(name: string | undefined): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name || "")?.[1]?.toLowerCase() || "";
  return ext in TYPES ? ext : "m4a";
}

export function audioType(ext: string): string {
  return TYPES[ext] || "audio/mp4";
}

/** Turns a voice recording into text with OpenAI. Returns null when there is no key or the service fails; the recording is kept either way. */
export async function transcribe(audio: Buffer, ext: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: audioType(ext) }), `voice.${ext}`);
    form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(50000),
    });
    if (!res.ok) {
      console.error("Transcription failed", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const j = await res.json();
    return typeof j.text === "string" && j.text.trim() ? j.text.trim().slice(0, 20000) : null;
  } catch (e) {
    console.error("Transcription failed", e);
    return null;
  }
}
