// Turns text into a 384-number "fingerprint" of its meaning, using the model
// built into Supabase. Called by the app with the signed-in user's token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const session = new Supabase.ai.Session("gte-small");

// Asks the database whether the caller's token belongs to the owner.
// Public-key and stranger tokens get false, so nobody else can spend compute here.
async function isOwner(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!auth || !apikey) return false;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/is_owner`, {
    method: "POST",
    headers: { authorization: auth, apikey, "content-type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!(await isOwner(req))) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  try {
    const { input } = await req.json();
    if (typeof input !== "string" || input.trim() === "") {
      return Response.json({ error: "input must be a non-empty string" }, { status: 400 });
    }
    const embedding = await session.run(input.slice(0, 4000), {
      mean_pool: true,
      normalize: true,
    });
    return Response.json({ embedding });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
