import { authed } from "@/lib/server";
import { createSave, setPicture, type NewSave } from "@/lib/process";

export const maxDuration = 60;

export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.kind === "picture" && typeof body.id === "string" && typeof body.path === "string" && body.path.startsWith(`${a.userId}/upload-`)) {
    try {
      return Response.json({ save: await setPicture(a, body.id, body.path) });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Could not add the picture" }, { status: 500 });
    }
  }
  let input: NewSave | null = null;
  if (body?.kind === "link" && typeof body.url === "string") {
    try {
      const u = new URL(body.url.trim());
      if (u.protocol === "http:" || u.protocol === "https:") {
        input = { kind: "link", url: u.toString(), image: typeof body.image === "string" && /^https?:\/\//.test(body.image) ? body.image.slice(0, 2000) : undefined };
      }
    } catch { /* not an address */ }
  } else if (body?.kind === "note" && typeof body.text === "string" && body.text.trim()) {
    input = { kind: "note", text: body.text.trim().slice(0, 20000) };
  } else if (body?.kind === "image" && typeof body.path === "string" && body.path.startsWith(`${a.userId}/`)) {
    input = { kind: "image", path: body.path, name: typeof body.name === "string" ? body.name.slice(0, 120) : undefined };
  }
  if (!input) return Response.json({ error: "Nothing to save." }, { status: 400 });

  try {
    const save = await createSave(a, input);
    return Response.json({ save });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
