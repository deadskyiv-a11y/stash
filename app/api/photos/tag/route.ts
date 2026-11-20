import { authed } from "@/lib/server";
import { tagPhoto } from "@/lib/ai";

export const maxDuration = 300;

const COLUMNS = "id,tags,caption,subject,tagged";

/** Has the AI look at one photo's thumbnail and write its subject, tags and a one-line description. */
export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const { data: photo } = await a.db.from("photos").select("id,thumb_path,subject,place,taken_at").eq("id", id).single();
  if (!photo?.thumb_path) return Response.json({ error: "That photo has no thumbnail to read." }, { status: 400 });

  const { data: file } = await a.db.storage.from("saves").download(photo.thumb_path);
  if (!file) return Response.json({ error: "Could not open the thumbnail." }, { status: 500 });

  const { data: rows } = await a.db.from("photos").select("subject").not("subject", "is", null).order("created_at", { ascending: false }).limit(1000);
  const subjects = [...new Set((rows || []).map((r) => r.subject as string))];

  // How the rest of the same shoot was filed: photos taken within three hours either side of this one.
  let shoot: string | null = null;
  if (photo.taken_at) {
    const t = new Date(photo.taken_at).getTime(), span = 3 * 60 * 60 * 1000;
    const { data: near } = await a.db.from("photos").select("subject").neq("id", id).not("subject", "is", null)
      .gte("taken_at", new Date(t - span).toISOString()).lte("taken_at", new Date(t + span).toISOString()).limit(500);
    const counts = new Map<string, number>();
    for (const r of near || []) counts.set(r.subject as string, (counts.get(r.subject as string) || 0) + 1);
    if (counts.size) shoot = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([s, n]) => `${s} (${n})`).join(", ");
  }

  const out = await tagPhoto(Buffer.from(await file.arrayBuffer()), subjects, photo.place, shoot);
  if (!out) return Response.json({ error: "The AI could not read that photo just now." }, { status: 502 });

  const { data: done, error } = await a.db
    .from("photos")
    // A subject Kofi set by hand is kept.
    .update({ tags: out.tags, caption: out.caption, tagged: true, ai_in: out.usage.in, ai_out: out.usage.out })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error || !done) return Response.json({ error: error?.message || "Could not save the tags." }, { status: 500 });
  // The subject is filled in only where it is still empty at this moment, so one typed by hand while the AI was looking is kept.
  const { data: filled } = await a.db.from("photos").update({ subject: out.subject }).eq("id", id).is("subject", null).select(COLUMNS).maybeSingle();
  if (filled) return Response.json({ photo: filled });
  const { data: now } = await a.db.from("photos").select(COLUMNS).eq("id", id).single();
  if (now) return Response.json({ photo: now });
  return Response.json({ photo: done });
}
