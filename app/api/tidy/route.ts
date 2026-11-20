import { authed } from "@/lib/server";
import { tidy } from "@/lib/ai";
import { SAVE_COLUMNS, type Save } from "@/lib/types";

export const maxDuration = 300;

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

  // Moves that end in the same place go in one update, so a big tidy is a handful of calls, not hundreds.
  const groups = new Map<string, { cluster: string; subgroup: string | null; ids: string[] }>();
  for (const m of moves) {
    const row = rows[m.n - 1];
    if (!row || (row.cluster === m.cluster && (row.subgroup || null) === m.subgroup)) continue;
    const key = m.cluster + "\u0000" + (m.subgroup || "");
    if (!groups.has(key)) groups.set(key, { cluster: m.cluster, subgroup: m.subgroup, ids: [] });
    groups.get(key)!.ids.push(row.id);
  }
  const changed: Save[] = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 100) {
      const { data: done } = await a.db.from("saves").update({ cluster: g.cluster, subgroup: g.subgroup }).in("id", g.ids.slice(i, i + 100)).eq("pinned", false).select(SAVE_COLUMNS);
      if (done) changed.push(...(done as unknown as Save[]));
    }
  }
  return Response.json({ saves: changed });
}
