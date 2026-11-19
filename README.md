# Stash

A private place to save links, images and notes. It reads each save, files it
into a cluster on an infinite white canvas, and finds things by meaning.

Working name. Change `NEXT_PUBLIC_APP_NAME` to rename the app.

## Parts

| Part | Where |
| --- | --- |
| App (Next.js) | `app/`, `components/`, `lib/` |
| Database schema | `supabase/migrations/0001_init.sql` |
| Meaning "fingerprint" function | `supabase/functions/embed/` |

## Setup

1. Create a Supabase project and run the migration in `supabase/migrations`.
2. Add the owner's email: `insert into private.allowed_emails values ('you@example.com');`
3. Deploy the `embed` edge function.
4. In Supabase, under Authentication, set the Site URL to the live web address.
5. Set the variables listed in `.env.example` in Vercel.

## What phase 1 covers

- Save by paste, drag and drop, or the Save button (links, images, notes).
- Each save is read: page preview image, title, summary, tags, cluster, key facts.
- Canvas with clusters, drag to move, scroll or pinch to zoom, glide to matches.
- List view, type filters, last 30 days.
- Search by meaning and by exact words.

Not yet built: sub-group splitting and merging, pinning, the Inbox arrival
animation, the iPhone share sheet, written answers, drawing only what is on screen.
