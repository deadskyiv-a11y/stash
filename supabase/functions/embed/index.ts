// Turns text into a 384-number "fingerprint" of its meaning, using the model
// built into Supabase. Called by the app with the signed-in user's token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
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
