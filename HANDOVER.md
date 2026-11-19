# Stash: handover to Claude Code

Written 19 November 2026 by Claude (chat session) for Claude Code running on Kofi's Mac.
Read this whole file before doing anything.

## 1. Your job, in order

1. **Deploy the app to Vercel.** This is the only thing blocking a live app. See section 4.
2. **Set the Supabase Site URL** to the live address, or walk Kofi through it. See section 5.
3. **Test end to end with Kofi** and fix what breaks. Nothing has been run yet. See section 6.
4. **Close the known gaps** in section 7, in the order listed.
5. Stop there and report. Phase 2 and 3 (section 9) need Kofi's go-ahead.

## 2. What Stash is

A private, single-user web app. Kofi saves links, images and notes. The app reads each
save, files it into a cluster on an infinite white canvas, and finds things by meaning.

- Owner and only user: Kofi Nsiah, `deadskyiv@gmail.com`.
- He is not a technical user. Explain in plain words. Tell him what to do. Do not offer menus.
- He writes with no em dashes. Follow that in anything he will read.
- Do not delete, move or change anything outside this project without asking him first.

Design and product decisions are settled. Do not redesign. The sources of truth:

| What | Where |
| --- | --- |
| Product and design spec | https://claude.ai/artifact/KHZVqUGAKpcvksGphvd4MJ |
| Figma spec sheet (tokens, type, components) | https://www.figma.com/design/0hRKFxW4vgoYaVmFVdFPzv |
| Approved clickable prototype, "Plain white" page | https://claude.ai/artifact/Sqi4x9ueW7bj3jmvQvKQkC |
| Logo | `public/logo.svg`, `components/Logo.tsx` |

The look in one line: plain white ground, bare images with no captions or borders,
grey pill controls with no shadow, ink for the active control only, no accent colour.
Tokens are in `app/globals.css` under `:root`.

## 3. Current state

### Done

- Code is in `github.com/deadskyiv-a11y/stash`, branch `main`. Next.js 16, React 19, TypeScript.
- `next build` and `eslint` pass.
- Supabase project **Stash** exists and is healthy.
  - Project ref: `drvmlzjpdvifdmlsnyku`
  - Region: `eu-west-2`
  - Organisation id: `wwubfxtegapykaulntpq` (the paid one, shared with Adwene and client projects)
- Migration `supabase/migrations/0001_init.sql` is applied (as migration `init`).
- Edge function `embed` is deployed, with JWT verification on.
- `private.allowed_emails` holds one row: `deadskyiv@gmail.com`.

### Not done

- **No Vercel project exists.** The chat session's Vercel connector returned 403 on project creation.
- Supabase Site URL is still the default, so the sign-in email link will not open the app.
- `ANTHROPIC_API_KEY` is not set anywhere.
- **Nothing has been tested at runtime.** No sign-in, save, image upload, search or canvas render.

## 4. Deploy to Vercel

Use the Vercel CLI on this Mac, signed in as Kofi. Check with `vercel whoami`.
If it is not signed in, ask Kofi to run `vercel login`.

- Team: "Kofi Nsiah's projects", slug `kofi-s-projects3`, id `team_2j4o0fy8gK3q5QZxhEbVRepi`.
- Project name: `stash`.
- Link the project to the GitHub repository so every push to `main` deploys.
- Check `vercel --help` for current flags. Do not trust remembered syntax.

Environment variables, for Production and Preview:

| Name | Value | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://drvmlzjpdvifdmlsnyku.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_V1mL6DGMdJvPPj0KrMxtpA_Ih1nvuQM` | No, public by design |
| `NEXT_PUBLIC_APP_NAME` | `Stash` | No |
| `ANTHROPIC_API_KEY` | Kofi supplies it | **Yes** |
| `ANTHROPIC_MODEL` | Optional. Code defaults to `claude-haiku-5-5`. | No |

Rules for the Anthropic key:

- Kofi creates it in the Anthropic console and types it into the terminal prompt himself.
- Never write it to a file in the repository, never echo it, never commit it.
- Mark it Sensitive in Vercel.
- The app works without it. Saves then land in a cluster called "Unsorted" with no summary or tags.

After the first deploy, confirm the build log is clean and note the production address.

## 5. Supabase sign-in setting

Sign-in is by email link. It needs the live address registered:

- Supabase dashboard, project Stash, Authentication, URL Configuration.
- Set **Site URL** to the Vercel production address.
- Add the same address under **Redirect URLs**.

If the Supabase CLI on this Mac is signed in and you can do this safely through it, do so.
Otherwise give Kofi the exact clicks.

## 6. Test plan

Run through this with Kofi on the live address. Fix each failure before moving on.

1. Open the app. The sign-in screen shows the stash wordmark.
2. Sign in with `deadskyiv@gmail.com`. The email link opens the app, signed in.
3. Empty state reads "Nothing saved yet".
4. Paste a link to an article with a preview image. A grey tile appears and pulses, then becomes the image.
5. Open the tile. Title, summary, tags, cluster and site are filled in.
6. Paste a link to a page with no preview image. It shows a grey tile with site name and title.
7. Drop an image file onto the page. It uploads and appears.
8. Press Save, write a note, submit. A yellow note tile appears.
9. Save a mostly white image. It gets a thin edge (`is_pale`).
10. Type in the command box. Non-matches fade, the canvas glides to the matches.
11. Search by meaning: use words that do not appear in any title.
12. Try Images, Links, Notes and Last 30 days. Try Canvas and List.
13. Click a cluster name. The canvas flies to it. "See all" returns.
14. Delete a save. It asks for confirmation, then disappears, and its image is removed from storage.
15. Sign in with a different email address. That account must see nothing and be unable to save.

Useful checks while testing: Vercel runtime logs for `/api/saves` and `/api/search`,
Supabase logs for the `embed` function, and the Supabase security advisors.

## 7. Known gaps, in priority order

1. **Runtime bugs.** Expect some. Section 6 will surface them.
2. **`embed` accepts any caller holding the public key.** It exposes no data but lets a stranger
   spend compute. Inside the function, verify the JWT's user and check `public.is_owner()`.
3. **Search threshold is a guess.** `search_saves` uses `min_similarity = 0.8` for the `gte-small`
   model. Tune it against real saves so unrelated items do not match.
4. **Sign-up is open at the auth level.** A stranger can create an account. Row rules and
   `is_owner()` stop them reading or writing anything, and the API routes reject them, but
   consider disabling sign-ups in Supabase once Kofi has signed in once.
5. **Links with no preview image** fall back to a grey text tile. The spec wants every link to
   carry a picture. A screenshot service is the fix. Ask Kofi before adding a paid one.
6. **Every tile is always in the page.** Fine for hundreds of saves. Add on-screen-only drawing
   before thousands.
7. **Trackpad behaviour differs from the spec on purpose.** Mouse wheel and pinch zoom,
   two-finger swipe pans. Confirm Kofi is happy with it.
8. **Supabase advisor warning** on `public.is_owner()` (a SECURITY DEFINER function callable by
   signed-in users). Intended. It returns only whether the caller is on the owner list.

## 8. How the code is laid out

| Path | What it does |
| --- | --- |
| `app/page.tsx`, `components/App.tsx` | The whole client app: sign-in, state, command box, filters, list, detail panel, capture |
| `components/Canvas.tsx` | The canvas: camera, drag, zoom, glide, tiles, labels |
| `lib/layout.ts` | Places tiles into clusters and sub-groups |
| `app/api/saves/route.ts` | Accepts a new link, note or uploaded image |
| `lib/process.ts` | Reads a save: fetch page, store preview, ask Claude, embed, update the row |
| `lib/fetch-page.ts` | Fetches pages and images. Blocks private and internal addresses. Keep that guard. |
| `lib/ai.ts` | The Claude call that writes title, summary, tags, cluster, sub-group, facts |
| `app/api/search/route.ts` | Embeds the query and calls `search_saves` |
| `lib/server.ts` | Builds a database client that acts as the signed-in user |
| `supabase/migrations/` | Database schema. Add new numbered files. Never edit an applied one. |
| `supabase/functions/embed/` | Edge function that turns text into a 384-number vector |

How it fits together:

- The browser talks to Supabase directly for reading saves, signed image addresses and deletes.
  Row-level rules do the protecting.
- The two API routes take the user's access token in an `Authorization: Bearer` header and act
  as that user. There is no service-role key in this app. Do not add one.
- Images live in the private `saves` bucket under `<user id>/`.

## 9. What comes after, only when Kofi says go

- **Phase 2:** Inbox zone with arrival animation, sub-groups that split and merge as clusters
  grow, pinning (a `pinned` column already exists), a "Tidy" action.
- **Phase 3:** iPhone screen, an Apple Shortcut for the share sheet, written answers with
  sources in the command box.

## 10. House rules for this repository

- Read `AGENTS.md`. This is Next.js 16. Check `node_modules/next/dist/docs/` before using an
  API from memory.
- Run `npx next build` and `npx eslint .` before every push.
- Schema changes go in a new migration file and are applied to project `drvmlzjpdvifdmlsnyku`.
- No secrets in the repository. `.env.example` lists names only.
- Keep the look. If a change would add a colour, a shadow, a border or a caption on the canvas,
  it is against the spec. Ask first.
- Tell Kofi what you did and what you could not verify. Do not report something as working
  unless you ran it.
