import { authed } from "@/lib/server";
import { tagPhoto } from "@/lib/ai";

export const maxDuration = 60;

const COLUMNS = "id,tags,caption,subject,tagged";

/** Has the AI look at one photo's thumbnail and write its subject, tags and a one-line description. */
export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const { data: photo } = await a.db.from("photos").select("id,thumb_path,subject,place").eq("id", id).single();
  if (!photo?.thumb_path) return Response.json({ error: "That photo has no thumbnail to read." }, { status: 400 });

  const { data: file } = await a.db.storage.from("saves").download(photo.thumb_path);
  if (!file) return Response.json({ error: "Could not open the thumbnail." }, { status: 500 });

  const { data: rows } = await a.db.from("photos").select("subject").not("subject", "is", null).limit(2000);
  const subjects = [...new Set((rows || []).map((r) => r.subject as string))];

  const out = await tagPhoto(Buffer.from(await file.arrayBuffer()), subjects, photo.place);
  if (!out) return Response.json({ error: "The AI could not read that photo just now." }, { status: 502 });

  const { data: done, error } = await a.db
    .from("photos")
    // A subject Kofi set by hand is kept.
    .update({ tags: out.tags, caption: out.caption, subject: photo.subject || out.subject, tagged: true, ai_in: out.usage.in, ai_out: out.usage.out })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error || !done) return Response.json({ error: error?.message || "Could not save the tags." }, { status: 500 });
  return Response.json({ photo: done });
}
