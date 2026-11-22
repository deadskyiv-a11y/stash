import { authed } from "@/lib/server";
import { createSave, makeRecipe, setPicture, type NewSave } from "@/lib/process";

// Reading a long voice note or a large PDF can take well over a minute. Cut off early, a save was left half made.
export const maxDuration = 300;

const TRACKERS = /^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|igshid|igsh|mc_cid|mc_eid|_hsenc|_hsmi|ref_src|ref_url|yclid|ttclid|twclid|li_fat_id|s_kwcid|vero_id|oly_anon_id|oly_enc_id)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.kind === "picture" && typeof body.id === "string" && UUID.test(body.id) && typeof body.path === "string" && body.path.startsWith(`${a.userId}/upload-`)) {
    try {
      return Response.json({ save: await setPicture(a, body.id, body.path) });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Could not add the picture" }, { status: 500 });
    }
  }
  if (body?.kind === "recipe" && typeof body.id === "string" && UUID.test(body.id)) {
    try {
      return Response.json({ save: await makeRecipe(a, body.id) });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Could not work out the recipe" }, { status: 500 });
    }
  }
  let input: NewSave | null = null;
  if (body?.kind === "link" && typeof body.url === "string") {
    try {
      const u = new URL(body.url.trim());
      if (u.protocol === "http:" || u.protocol === "https:") {
        // Tracking codes say where a click came from, not what the page is. Without them the same page saved twice is one address.
        for (const k of [...u.searchParams.keys()]) if (TRACKERS.test(k)) u.searchParams.delete(k);
        const shot = typeof body.shot === "string" && body.shot.startsWith(`${a.userId}/upload-`) ? body.shot : undefined;
        input = { kind: "link", url: u.toString(), shot, image: typeof body.image === "string" && /^https?:\/\//.test(body.image) ? body.image.slice(0, 2000) : undefined };
      }
    } catch { /* not an address */ }
  } else if (body?.kind === "note" && typeof body.text === "string" && body.text.trim()) {
    input = { kind: "note", text: body.text.trim().slice(0, 20000) };
    // A quote taken from a page keeps the page's address and name.
    try {
      const u = typeof body.url === "string" ? new URL(body.url) : null;
      if (u && (u.protocol === "http:" || u.protocol === "https:")) {
        input.url = u.toString();
        if (typeof body.from === "string") input.from = body.from.slice(0, 200);
      }
    } catch { /* no source */ }
  } else if ((body?.kind === "image" || body?.kind === "file" || body?.kind === "voice") && typeof body.path === "string" && body.path.startsWith(`${a.userId}/upload-`)) {
    // Only a fresh upload may be named here. The server moves or deletes this file, so it must never be an existing save's file.
    input = { kind: body.kind, path: body.path, name: typeof body.name === "string" ? body.name.slice(0, 120) : undefined };
    if (input.kind === "file" && typeof body.cover === "string" && body.cover.startsWith(`${a.userId}/upload-`)) input.cover = body.cover;
  }
  if (!input) return Response.json({ error: "Nothing to save." }, { status: 400 });

  try {
    const save = await createSave(a, input);
    return Response.json({ save });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
