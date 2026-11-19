import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Authed = { db: SupabaseClient; userId: string; token: string };

/**
 * Builds a database client that acts as the caller. Every query it runs is
 * subject to the row-level rules, so a request can only ever touch the
 * caller's own saves. Returns null when the caller is not signed in or is
 * not on the owner list.
 */
export async function authed(req: Request): Promise<Authed | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: owner } = await db.rpc("is_owner");
  if (owner !== true) return null;
  return { db, userId: data.user.id, token };
}

export async function embed(a: Authed, text: string): Promise<number[] | null> {
  const input = text.replace(/\s+/g, " ").trim();
  if (!input) return null;
  const { data, error } = await a.db.functions.invoke("embed", { body: { input } });
  if (error || !data?.embedding) return null;
  return data.embedding as number[];
}
