import { authed, embed } from "@/lib/server";

export const maxDuration = 30;

export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 300) : "";
  if (!q) return Response.json({ results: [] });

  const embedding = await embed(a, q);
  const { data, error } = await a.db.rpc("search_saves", {
    query_text: q,
    query_embedding: embedding ? JSON.stringify(embedding) : null,
    match_count: 60,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ results: data || [], meaning: Boolean(embedding) });
}
