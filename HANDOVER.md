# Stash: handover

Rewritten 19 November 2026 by Claude Code at the end of the day Stash went live.
Read this whole file before doing anything.

## 1. Where things stand

Stash is live and Kofi uses it. All three phases of the spec are built.

- **Live address:** https://stash-gamma-jet.vercel.app
- Every push to `main` deploys to production.
- There is no job in progress. Wait for Kofi to ask for something, or pick from section 7 with
  his go-ahead.

After any push, tell Kofi to reload Stash (Cmd+R, or pull down on the phone). An open tab keeps
running the old version and he will not see the change.

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

## 3. What is set up

- **Code:** `github.com/deadskyiv-a11y/stash`, branch `main`. Next.js 16, React 19, TypeScript.
- **Vercel:** team `kofi-s-projects3` (id `team_2j4o0fy8gK3q5QZxhEbVRepi`), project `stash`
  (id `prj_EKJ2fV8Dn4w7oiuIAj9fzkRdAs47`), framework set to `nextjs`, connected to the GitHub
  repository. `stash.vercel.app` belongs to someone else. Ours is `stash-gamma-jet.vercel.app`.
- **Supabase:** project **Stash**, ref `drvmlzjpdvifdmlsnyku`, region `eu-west-2`, organisation
  `wwubfxtegapykaulntpq` (the paid one, shared with Adwene and client projects).
  - Migrations `0001_init.sql`, `0002_file_path.sql` and `0003_form_and_excerpt.sql`, `0004_photos.sql`, `0005_photo_film.sql`, `0006_photo_tags.sql`, `0007_photo_projects.sql`, `0008_save_recipe.sql` and `0009_photo_view.sql` are applied.
  - Edge function `embed` is at version 2, JWT verification on, and answers only the owner.
  - `private.allowed_emails` holds one row: `deadskyiv@gmail.com`.
  - Site URL and Redirect URLs point at the live address.
  - New sign-ups are **off**. Kofi's own sign-in is unaffected.
  - The Magic Link email template was changed by Kofi to include the 6-digit code
    (`{{ .Token }}`). This lives in the Supabase dashboard, not in the repository.
- **Environment variables in Vercel** (names are in `.env.example`): the two Supabase values,
  `NEXT_PUBLIC_APP_NAME`, and `ANTHROPIC_API_KEY` (Sensitive, typed in by Kofi).
  `.env.local` on this Mac has an empty `ANTHROPIC_API_KEY`, so AI features cannot be run locally.

Rules for the Anthropic key: Kofi types it into the terminal himself. Never write it to a file
in the repository, never echo it, never commit it.

## 4. What the app does now

**Saving**
- Paste or drop anywhere, or use the Save box. Links, notes, images and PDFs (up to 20 MB).
- A PDF is kept in the bucket as `<user id>/<save id>.pdf` (`file_path` column). The AI reads
  the PDF itself (up to 15 MB) for title, summary, facts and filing. "Open PDF" in the side
  panel opens it. Its tile shows the first page: the browser draws it with `pdfjs-dist`
  (`lib/pdf-cover.ts`) and uploads it with the save. No full text is extracted.
  Saving and opening are confirmed by Kofi. The cover is tested only on this Mac.
- iPhone share sheet: an Apple Shortcut on Kofi's phone opens
  `https://stash-gamma-jet.vercel.app/#save=<encoded link>`. The app saves the link on load and
  cleans the address. It rides on the browser's own sign-in, so it opens Stash each time.

- Laptop browser button: "Save to Stash" in the logo menu is a bookmarklet Kofi drags to his
  bookmarks bar. It opens `/#save=<link>&img=<picture>` in a new tab, passing the page's
  `og:image` or video poster as his own browser saw it. The server uses that picture only when
  it could not get one itself. Untried, and unverified for TikTok.
- Quotes: with text highlighted on the page, the same button adds `&q=<text>&t=<page title>`.
  Stash saves that as a note that keeps the page's address as its source. Untried. Kofi must
  drag the button to his bookmarks bar again after any change to the bookmarklet code.
- Kofi uses Arc, which has no bookmarks bar. `extension/` is a small Chrome extension that does
  the same job as the bookmarklet: toolbar button or Option+Shift+S. Loaded unpacked from this
  folder, so it must stay where it is. Untried.
- Spotify saves also carry the artist, year and track list, read from Spotify's public embed
  page (`spotifyDetails` in `lib/fetch-page.ts`). Confirmed by Kofi.

**Pictures for links**
- Ordinary sites: the page's own preview image.
- YouTube, Instagram, Vimeo, Spotify: each platform's official oEmbed address, tried before the
  page itself (`OEMBED` list in `lib/fetch-page.ts`). YouTube uses the full-size thumbnail when
  the video has one.
- IMDb links: IMDb puts a robot check in front of its pages, so the title, plot and poster come
  from OMDb by IMDb number (`fromOmdb` in `lib/fetch-page.ts`, key `OMDB_API_KEY` in Vercel).
- Anything else that comes in bare: open the save and paste, drop or choose a picture
  ("Add picture" / "Change picture"). The AI re-reads the save with that picture and updates
  title, summary, tags, group and search.
- **TikTok has no automatic picture.** See section 7.

**Filing**
- The AI files by subject (Travel, Film, Design), never by format or source. It writes in
  English whatever language the item is in, and keeps names as they are.
- A long caption is never used as the title. Only its first line is passed as the working title.
- "Move to a group" in the side panel files a save by hand and pins it.
- **Pin** keeps a save in its group. Tidy and re-reads never re-file a pinned save.
- **Tidy** (beside "See all") asks the AI to merge duplicate groups and rehome Unsorted saves,
  moving as little as possible. One AI call over the newest 400 unpinned saves.
- Sub-groups show only once a group has 6 or more saves, and only for sub-groups of 2 or more.
  This is a display rule in `lib/layout.ts`. The stored sub-group is never rewritten by it.
- A new save sits under "Inbox" while it is read, then travels to its group (0.8 seconds).

**Recipes**
- When a save is about cooking a dish, the AI sets `form` to `recipe` and writes the recipe into
  the `recipe` column: dish, serves, time, ingredients with amounts, numbered steps. The panel
  shows it under the picture. `RECIPE_RULES` and `parseRecipe` in `lib/ai.ts`.
- **The AI does not watch the video.** It has the caption or description and the cover picture.
  It keeps what the post gives and fills gaps from its own knowledge of the dish. `basis` records
  which: `post` or `ai`, and the panel says so plainly. Do not remove that line.
- Instagram captions often hold the whole recipe. YouTube gives only a title through oEmbed, and
  TikTok gives nothing, so those are mostly the AI's own version. The YouTube Data API (free
  key, his existing Google Cloud project) would give video descriptions. Offered, not built.
- "Write out the recipe" appears on a food-related save with no recipe, for older saves or ones
  the AI did not spot (`makeRecipe` in `lib/process.ts`).
- Untried on the live site.

**Voice notes**
- "Record" in the Save box (New note on the phone) records in the browser. Audio files can also
  be dropped in or chosen. A voice note is a note whose `file_path` is the recording and whose
  text is the transcript (`form` = `voice`). The side panel plays it back.
- Transcription is OpenAI (`lib/transcribe.ts`, key `OPENAI_API_KEY`, model
  `gpt-4o-mini-transcribe` unless `OPENAI_TRANSCRIBE_MODEL` says otherwise). With no key or a
  failed call, the recording is still kept and plays, with no text, filed under Unsorted.
- Kofi recorded one note and says it transcribed and filed. He deleted it before it could be
  checked in the database. Accuracy on Twi or Ga words is still unknown.

**How kinds look different** (Kofi asked for this on 19 November 2026; it bends the spec's
"no captions on the canvas" rule for articles only)
- Articles show a caption under the picture: headline, the page's opening words (`excerpt`,
  else the summary) and the site. The AI labels each new save's `form` (article, video, music,
  film, other). Older saves with no label count as articles unless they came from a media site.
  Rules are `isArticle` and `CAPTION_H` in `lib/layout.ts`, styles are `.cap` in `globals.css`.
- Films, videos and music stay as bare pictures.
- Quotes (a note with a source address) are grey with a quotation mark and the site name.
  Notes Kofi types stay yellow.
- An article's panel lists the quotes taken from its page. A quote's panel has "Open the
  article" when that page is saved too. Pages are matched by `samePage` in `lib/layout.ts`.
- Seen on this Mac with made-up saves. Not yet seen on the live site.

**Finding**
- Search as you type, by words and by meaning.
- A question plus Enter gives a written answer of up to three sentences, with the source saves
  listed as buttons. It answers only from the saves.
- Click a group name to focus it. Click it again, or "See all", to go back.

**Sign-in**
- Email with a 6-digit code typed into the app, or the link opened once. The code is the
  reliable route: a link works only once, in whichever window opens it first.

**Phone**
- Two-row header, one sliding row of controls at the bottom, one-finger pan, two-finger pinch.
- Paste and New note buttons replace Save in the header. Paste reads the clipboard (a picture
  if there is one, else text). New note opens the same box Save opens on the laptop. Untried.
- The spec says "No canvas on the phone". The canvas was built for the phone anyway and Kofi
  said the zoom works fine, so it stays unless he says otherwise.

## 4b. The photo room (started 19 November 2026)

A separate page, `/photos`, for sorting Kofi's selected photographs for his photo book. It shows
no Stash saves, and Stash shows no photos. Switch with the Photos pill by the logo or Option+P.

- **Originals go to Kofi's Google Drive**, straight from the browser, into
  `Stash Photos / <year> / <year-month> /` by the date the picture was taken. Stash asks only for
  the `drive.file` permission, so it sees only files it created. `lib/drive.ts`.
- **No secret and no server.** The browser gets a one-hour pass from Google and keeps it in the
  tab. Kofi clicks Connect again when it runs out. Needs `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- **Stash keeps a 640px thumbnail** (`<user id>/photos/<id>.jpg` in the `saves` bucket) and a row
  in `public.photos`: date taken, GPS, typed place, camera, lens, settings, Lightroom rating and
  keywords, and the Drive link and folder. `lib/photo-read.ts` reads these with `exifr`.
- A batch can be given one typed place, for cameras with no GPS.
- **Select** (bottom bar) lets him pick several photos: tap, Shift-click for a run, or "Select
  these" beside a group heading. A panel then sets Place, Camera, Lens or Film on all of them.
  On the phone that panel is a sheet across the bottom. Untried.
- **Places are real map positions.** The place box offers real places as he types (Photon, a free
  OpenStreetMap lookup, called from the browser: `lib/places.ts`). Picking one stores its
  position. The panel shows a small grey map with a pin; clicking the map moves the pin. A photo
  with GPS and no name gets its name looked up. `components/PlaceMap.tsx`. The map is a fixed
  grid of OpenStreetMap tiles with zoom buttons and no dragging. Tested on this Mac, not yet
  with a real photo. A Map view of the whole collection was offered for later.
- In a photo's panel Kofi can type over Taken (date), Place, Camera, Lens and Film, for what the
  file does not say. He scans film, so those files arrive with no camera and the wrong date.
  Changing the date does not move the original in Drive.
- RAW and HEIC: the original always uploads. The thumbnail comes from the preview inside the
  file when the browser cannot open it. Untested on Kofi's camera.
- Grid grouped by Date or Place. Removing a photo removes it from Stash only, never from Drive.
- **Step 1 is built. Reading a JPEG's details and thumbnail is tested on this Mac. Nothing that
  touches Drive has been run.** Kofi's plan: mostly high-quality JPEG exports from Lightroom,
  thousands of pictures over time.
- **Step 2 is built (19 November 2026), untried on the live site.** The AI reads each thumbnail
  (`/api/photos/tag`, `tagPhoto` in `lib/ai.ts`) and writes a subject, tags and a one-line
  description. The page queues every photo not yet read, one at a time, on load and after a
  deposit. Group by Date, Place or Subject. The search box filters by words across name, place,
  subject, description, tags, keywords, camera, lens, film and month. It is word matching in the
  browser, not search by meaning. Ratings show as a small mark on the tile, can be set with a
  star picker in the panel, and filter from the bottom bar.
- **The AI considers the shoot.** When reading a photo, the tag route tells it how other photos
  taken within three hours either side were filed, and asks it to keep a shoot together. This
  only shapes new readings; photos already read are not re-read. Untried.
- **Large view** (`components/BigView.tsx`). Clicking a photo in the grid opens it full-screen on
  white. Arrow keys or the side buttons step through the photos as currently shown; 1 to 5
  rate, 0 clears; I toggles the details panel; Esc closes. **Zoom** up to 12 times: click a spot
  (2.5 times, click again to fit), pinch on a trackpad, roll a mouse wheel, + and - keys, or the
  buttons. Drag or two-finger swipe to move around. New uploads keep an 1800px preview
  (`view_path`, `<id>-view.jpg`); older photos show their 640px thumbnail, marked "small
  preview". "Load the original" fetches the full file from Drive into the browser, which is
  what makes deep zoom sharp. Zoom, drag and rating keys tested on this Mac with a sample
  picture; Kofi confirmed the view opens. Two earlier versions shipped untested and had bugs.
- **Drive pass renewal.** A batch starts on a fresh pass, and one about to run out is renewed
  mid-batch. Google renews through a pop-up window, which the browser may block when no click
  led to it. The batch then pauses and a card offers "Connect and carry on" with the photos
  still waiting. Untried. A server-side refresh token would remove the pop-up altogether.
- **Map view** (Grid | Map in the bottom bar). Every photo with a position, passing the current
  search and filters, on a draggable map (`leaflet`, `components/PhotoMap.tsx`). Photos close
  together share one pin with a count; clicking it zooms in, or lists the photos when they sit
  on one spot. A lone pin opens its photo. Photos with no position are counted in a note.
  Tested on this Mac with made-up positions, not on the live site. Leaflet blends tile edges
  with `plus-lighter`, which shows as white seams under the grey filter; `globals.css` overrides it.
- **Projects.** A photo can be in several projects or none (`projects text[]` on the row; the
  list of projects is every name in use). Add or remove from a photo's panel or from a selection
  (`set_photo_project` database function, one call for many photos). Group by Project, or show
  one project with the picker in the bottom bar. Untried.
- Measured cost of reading, on his first 13 photos: about 760 tokens in and 130 out each, roughly
  USD 0.14 per 1,000 photos at Haiku 5.5's listed prices.
- Each row records the tokens its reading used (`ai_in`, `ai_out`).
- **Agreed next steps:** (3) photo book tools such as shortlists, once he
  has used it. Measure the AI cost on his first 50 photos and tell him before he loads many.

## 5. Confirmed, and not yet tried

**Confirmed on the live site**, by Kofi or by checking the database:
sign-in with the code, saving links, notes and images, pale-image edge, search by meaning,
filters, list view, delete (removes the stored file too), YouTube and Instagram pictures,
filing by subject, a French caption filed in English, the iPhone share button, pinch zoom on
the phone, Pin, written answers, sign-ups disabled, and the `embed` lock (the owner gets
embeddings, the public key gets 403).

A stranger's access was proven in SQL with an impersonated token, not with a real second
account: no saves seen, no files seen, inserts and updates blocked.

**Built but never tried by anyone:**
- Pasting or dropping a picture onto an open save, and the AI re-read that follows.
- Move to a group.
- A new save travelling from the Inbox to its group.
- The side panel keeping long text inside its edge.
- Tidy with something real to tidy. Kofi ran it on four well-filed saves and nothing moved.
- Vimeo and Spotify pictures on the live site (they work when run on this Mac).
- The fix for a touch tap landing on the newly opened panel. It was a best guess at what Kofi
  called "a bit buggy" when opening a save on the phone.

## 6. Things that bit us

- **An empty AI reply means the model ran out of room.** `claude-haiku-5-5` thinks before it
  answers, and thinking counts against `max_tokens`. With a tight cap the reply stops before any
  text, and the code sees "Unexpected end of JSON input". Three of Kofi's first 13 photos failed
  this way, and the unsorted French reel earlier was almost certainly the same fault. Every call
  in `lib/ai.ts` now sets `output_config: { effort: "low" }` and a roomy `max_tokens`. Do not
  tighten those caps to save money; output is billed by what is used, not by the cap.
- The Vercel MCP tool `get_runtime_logs` does show function errors, where the CLI showed nothing.

- **Sign-in emails are capped at about 2 an hour.** Supabase's built-in mailer is shared and
  rate-limited. Do not request sign-in emails to test. The fix, if Kofi ever wants it, is a
  proper email service (Resend) with a verified domain. He was advised to skip it for now.
- **Claude Code cannot sign in as Kofi**, so nothing behind sign-in can be tested from here.
  Check results in the database, check the deployed files for new strings, and ask Kofi to try
  the rest. Say plainly what was not verified.
- **Big platforms hide pictures from servers.** YouTube, Instagram and TikTok send a data
  centre an empty page. oEmbed is the honest way in. Do not pretend to be another company's
  preview robot to get past this.
- **Rows with stored pictures cannot be deleted cleanly from SQL.** The file would be left
  behind. Delete in the app, which removes both.
- The Vercel CLI here is old (58.x) and its log search returned nothing. Do not rely on it.

## 7. Open items

1. **TikTok covers.** TikTok's oEmbed no longer returns a picture or title, and a free preview
   service returned only the logo. Kofi does not want to paste screenshots. The offer on the
   table is a trial of a paid preview service (Iframely was suggested, unverified for TikTok).
   He has not signed up. Ask before adding anything paid.
2. **Dragging a tile to a chosen spot.** The spec imagines it. Pinning today fixes the group,
   not the position. Not built, not asked for yet.
3. **Background save from the share sheet.** Today the Shortcut opens Stash. A silent save
   needs a personal token system. Not asked for yet.
4. **Search threshold is still a guess.** `search_saves` uses `min_similarity = 0.8`, and the
   answer route uses 0.76. Tune against real saves once there are a few dozen.
5. **Every tile is always in the page.** Fine for hundreds of saves. Add on-screen-only drawing
   before thousands. The spec asks for 60 frames a second at 2,000 saves.
6. **Trackpad behaviour** differs from the spec on purpose (wheel and pinch zoom, two-finger
   swipe pans). Kofi has not said whether he is happy with it.
7. **Supabase advisor warning** on `public.is_owner()`. Intended. It returns only whether the
   caller is on the owner list.

## 8. How the code is laid out

| Path | What it does |
| --- | --- |
| `app/page.tsx`, `components/App.tsx` | The whole client app: sign-in, state, command box, answers, filters, list, detail panel, capture, pin, move, tidy |
| `components/Canvas.tsx` | The canvas: camera, drag, pinch, zoom, glide, tiles, labels |
| `lib/layout.ts` | Places tiles into clusters and sub-groups |
| `app/api/saves/route.ts` | Accepts a new link, note or image, or a picture for an existing save |
| `app/api/search/route.ts` | Embeds the query and calls `search_saves` |
| `app/api/answer/route.ts` | Finds the closest saves and asks Claude for a written answer |
| `app/api/tidy/route.ts` | Asks Claude to re-file unpinned saves and applies the moves |
| `lib/process.ts` | Reads a save: fetch page, store preview, ask Claude, embed, update the row. Also `setPicture` |
| `lib/fetch-page.ts` | Fetches pages, images and oEmbed. Blocks private and internal addresses. Keep that guard. |
| `lib/ai.ts` | The three Claude calls: read a save, tidy, answer |
| `lib/server.ts` | Builds a database client that acts as the signed-in user |
| `supabase/migrations/` | Database schema. Add new numbered files. Never edit an applied one. |
| `supabase/functions/embed/` | Edge function that turns text into a 384-number vector. Owner only. |

How it fits together:

- The browser talks to Supabase directly for reading saves, signed image addresses, deletes,
  pin and move. Row-level rules do the protecting.
- The API routes take the user's access token in an `Authorization: Bearer` header and act
  as that user. There is no service-role key in this app. Do not add one.
- Images live in the private `saves` bucket under `<user id>/`.
- To deploy the edge function:
  `supabase functions deploy embed --project-ref drvmlzjpdvifdmlsnyku --use-api`

## 9. House rules for this repository

- Read `AGENTS.md`. This is Next.js 16. Check `node_modules/next/dist/docs/` before using an
  API from memory.
- Run `npx next build` and `npx eslint .` before every push.
- Schema changes go in a new migration file and are applied to project `drvmlzjpdvifdmlsnyku`.
- No secrets in the repository. `.env.example` lists names only.
- Keep the look. If a change would add a colour, a shadow, a border or a caption on the canvas,
  it is against the spec. Ask first.
- Tell Kofi what you did and what you could not verify. Do not report something as working
  unless you ran it.
