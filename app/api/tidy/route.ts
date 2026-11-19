import { authed } from "@/lib/server";
import { tidy } from "@/lib/ai";
import { SAVE_COLUMNS, type Save } from "@/lib/types";

export const maxDuration = 60;

/** Re-files saves by subject when Kofi asks. Pinned saves are never touched. */
export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "Not signed in, or not the owner of this app." }, { status: 401 });

  // ponytail: one AI call over the newest 400 unpinned saves. Batch by cluster if the library outgrows that.
  const { data, error } = await a.db
    .from("saves")
    .select("id,title,summary,tags,cluster,subgroup")
    .eq("status", "ready")
    .eq("pinned", false)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = data || [];
  if (rows.length < 2) return Response.json({ saves: [] });

  const moves = await tidy(rows.map((r, i) => ({ n: i + 1, title: r.title, summary: r.summary, tags: r.tags || [], cluster: r.cluster, subgroup: r.subgroup })));
  if (!moves) return Response.json({ error: "Could not tidy just now. Nothing was moved." }, { status: 502 });

  const changed: Save[] = [];
  for (const m of moves) {
    const row = rows[m.n - 1];
    if (!row || (row.cluster === m.cluster && (row.subgroup || null) === m.subgroup)) continue;
    const { data: done } = await a.db.from("saves").update({ cluster: m.cluster, subgroup: m.subgroup }).eq("id", row.id).eq("pinned", false).select(SAVE_COLUMNS).single();
    if (done) changed.push(done as unknown as Save);
  }
  return Response.json({ saves: changed });
}
