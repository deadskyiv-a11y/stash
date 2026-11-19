# Stash

Kofi's private save-everything app. Next.js 16, Supabase, Vercel, Claude.

**Start here: read `HANDOVER.md` in full.** It holds the current state, the next
jobs in order, every ID you need, the test plan and the known gaps.

## Working with Kofi

- He is not a technical user. Use plain words. Tell him what to do. Do not offer menus.
- No em dashes in anything he will read.
- Do not delete, move or change anything outside this folder without asking first.
- Say what you did and what you could not verify. Never report something as working unless you ran it.

## Rules for this project

- This is Next.js 16. Read `AGENTS.md` and check `node_modules/next/dist/docs/` before using an API from memory.
- Run `npx next build` and `npx eslint .` before every push.
- Database changes go in a new numbered file in `supabase/migrations/`. Never edit an applied one.
- No secrets in the repository. `.env.local` is ignored by git. `.env.example` lists names only.
- There is no service-role key in this app. Do not add one.
- Keep the look: plain white ground, bare images, grey pill controls, no accent colour, no shadows, no captions on the canvas. If a change breaks that, ask first.

## Where things are

- Live database: Supabase project `drvmlzjpdvifdmlsnyku` (eu-west-2).
- Repository: `github.com/deadskyiv-a11y/stash`, branch `main`.
- Spec, Figma sheet and prototype links are in `HANDOVER.md`, section 2.
