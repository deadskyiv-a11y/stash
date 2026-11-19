import { authed, embed } from "@/lib/server";
import { answer } from "@/lib/ai";

export const maxDuration = 60;

/** Answers a question from the saves alone, and says which saves the answer came from. */
export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 300) : "";
  if (!q) return Response.json({ error: "Ask a question." }, { status: 400 });

  const embedding = await embed(a, q);
  // A question is worded loosely, so cast a slightly wider net than plain search does.
  const { data: hits, error } = await a.db.rpc("search_saves", {
    query_text: q,
    query_embedding: embedding ? JSON.stringify(embedding) : null,
    match_count: 8,
    min_similarity: 0.76,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const ids: string[] = (hits || []).map((h: { id: string }) => h.id);
  if (ids.length === 0) return Response.json({ answer: "Nothing in your saves answers that.", sources: [] });

  const { data: rows } = await a.db.from("saves").select("id,kind,title,summary,note,site,url,facts,content,created_at").in("id", ids);
  const ordered = ids.map((id) => (rows || []).find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  const out = await answer(q, ordered.map((r, i) => ({
    n: i + 1, title: r.title, summary: r.summary, note: r.note, site: r.site, facts: r.facts || [], content: r.content, saved: r.created_at,
  })));
  if (!out) return Response.json({ error: "Could not answer just now." }, { status: 502 });
  return Response.json({ answer: out.answer, sources: out.sources.map((n) => ordered[n - 1]?.id).filter(Boolean) });
}
