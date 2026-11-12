# Feed videos inside the system - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the backoffice makes, approves and keeps current the 10-second videos of the Meta activities feed for the artists staff switch on - nobody runs a script.

**Architecture:** pure rules in `lib/feed-video/` (shared with the hand tool, so its 80 lines and files carry over); one renderer (`renderVideo`, Chromium + ffmpeg) that is measured on Vercel FIRST (a spike, before any migration); a cron 30 minutes before each feed publish that writes missing lines (agent #4), renders through an internal route, and swaps `events.campaign_video_url`; a browser-free check at the start of every feed publish that takes down any video that no longer matches.

**Tech Stack:** Next.js 15 route handlers + server actions, Supabase (`supabaseTyped`), `@sparticuz/chromium` + `playwright-core` (present), `ffmpeg-static` (new), Anthropic SDK through `lib/agents/`.

**Spec:** `docs/superpowers/specs/2026-11-12-feed-video-in-system-design.md`

## Global Constraints

- Default off: `artists.feed_video_enabled` false; `FEED_VIDEO=off` takes every system video down and stops; `FEED_VIDEO_AI` must be literally `on` for any Claude call (agent layer rule; `AI_AGENTS=off` stops it).
- A line is written by Claude ONCE per show; no render, re-render or publish ever calls Claude.
- A video uploaded by hand (any `campaign_video_url` not under `/creatives/video/`) is never replaced, never taken down.
- A video in the published feed never prints a price other than its row's price.
- Files: bucket `public_resources`, path `creatives/video/event-<id>-<style>-<hash10>.mp4`; `TEMPLATE_VERSION` 2; the hash must equal the hand tool's for the same inputs (1175 = `e51c3b6a45`).
- Video: 1080x1350, 10 s, 30 fps, H.264 high, yuv420p, crf 20, silent AAC 64k, `+faststart`.
- Line rules (`lineProblem`): Hebrew, 3-7 words, at most 34 characters, no digits / $ ₪ € £ %, no quotes (a geresh is allowed), no alcohol words, at most one "!", no repeat of another show's line.
- Every server action starts with its guard and returns `{ ok: false, kind }` instead of throwing; every write audited.
- Migrations ride the push to master; never applied from a branch. Commit by path. No push without Dor's "push".

## Review Focus

1. **A hand-uploaded video on a switched-on artist's event** - the run, the publish check and `updateEvent` all leave it alone (tests in Tasks 1, 6, 7).
2. **The publish check cannot read the database** - every system video is taken down in one update and the feed still publishes (test in Task 7).
3. **Main moves a price between the check and the feed fetch** - that event's URL is nulled and the feed fetched once more (test in Task 7).
4. **An artist is switched off while its videos are live** - they come down at the next run AND at the next publish, rows and lines stay (tests in Tasks 6, 7).
5. **A person types a line that breaks a rule, or repeats another show's** - refused with the rule in Hebrew; nothing saved (test in Task 9).

---

### Task 1: Pure rules move to `lib/feed-video/` (the hand tool keeps working)

**Files:**
- Create: `lib/feed-video/rules.ts`, `lib/feed-video/template.ts` (moved from `scripts/feed-video/template.ts`, unchanged)
- Modify: `scripts/feed-video/feed-video.ts`, `scripts/feed-video/config.ts` (import from lib; delete the moved code)
- Test: `scripts/feed-video-selftest.ts`

**Interfaces:**
- Produces, in `lib/feed-video/rules.ts`:
  - `type VideoStyle = "A" | "B" | "C"`; `type PrintedVideo = Omit<VideoPage, "hook" | "logoSvg" | "fontDataUrl">` (key order: style, name, place, date, priceText, tagline, cta, cutout, photos, cutoutInC - the hash depends on it)
  - `TEMPLATE_VERSION = 2`, `VIDEO_BUCKET = "public_resources"`, `VIDEO_DIR = "creatives/video"`
  - `stylesFor(a: { cutout: string | null; photos: string[] }): VideoStyle[]` - in A, B, C order: A when a cutout, B when 3+ photos, C when 1+ photo
  - `drawStyle(eventId: number, styles: VideoStyle[]): VideoStyle` (the hand tool's sha1 draw, unchanged)
  - `keepOrDrawStyle(stored: VideoStyle | null, eventId: number, styles: VideoStyle[]): VideoStyle`
  - `videoHash(printed: PrintedVideo, line: string): string`; `videoFileName(eventId: number, style: VideoStyle, hash: string): string`
  - `isSystemVideoUrl(url: string | null | undefined): boolean` (`/creatives/video/` in the path)
  - `holdProblems(x: { expectedName: string; eventArtistName: string | null; kind: string; sitePrice: number | null; feedPrice: number; place: string }): string[]`
  - `lineProblem(line: string, others: string[]): string | null`; `LINES_SYSTEM: string` (the prompt, moved)
  - `printedFor(d: CreativeDefaults, a: { name: string; cutout: string; photos: string[]; cutoutInC: boolean }, style: VideoStyle, priceOn: boolean): PrintedVideo`

- [ ] **Step 1: Write the failing selftest** `scripts/feed-video-selftest.ts` (node:assert, run with tsx), asserting:
  - `stylesFor({ cutout: "x", photos: ["1","2","3"] })` deep-equals `["A","B","C"]`; one photo -> `["A","C"]`; none -> `["A"]`; no cutout, no photo -> `[]`
  - `drawStyle(1175, ["A","B","C"]) === "C"`, `drawStyle(1313, ["A"]) === "A"`
  - `keepOrDrawStyle("B", 1175, ["A","C"])` = `drawStyle(1175, ["A","C"])` (B no longer carried); `keepOrDrawStyle("A", 1175, ["A","B","C"]) === "A"`
  - `videoHash` of 1175's inputs (style C, name "אואזיס", place "מנצ'סטר", date "06.06.2027", priceText "ממוצע לנוסע $1,935", tagline `creativeTagline(false)`, cta "טיסה + מלון + כרטיס", Oasis's cutout + 3 photos from `scripts/feed-video/config.ts`, cutoutInC true) with line "גשם בחוץ, אש בפנים" === `"e51c3b6a45"`
  - `isSystemVideoUrl(".../public_resources/creatives/video/event-1-A-x.mp4")` true; a `campaign_videos/...` URL false; null false
  - `holdProblems` flags: a site price $1 off the feed; a place matching `/טיסה|\s\.\s/`; an empty place; another artist's name. Clean input -> `[]`
  - `lineProblem`: "גשם בחוץ, אש בפנים" null; "2 לילות בפריז" refused; "בירה קרה מול הבמה" refused; a 9-word line refused; "מנצ'סטר מרעידה את האדמה" null (geresh); a line equal to one in `others` refused
- [ ] **Step 2: Run** `npx tsx scripts/feed-video-selftest.ts` - Expected: FAIL (module not found)
- [ ] **Step 3: Implement `lib/feed-video/rules.ts`** by moving the hand tool's code; `printedFor` = the hand tool's `page` object (city by `cityOf`, `buildPriceText` when `priceOn` and a price, else null).
- [ ] **Step 4: Point the hand tool at lib** - `feed-video.ts` and `config.ts` import from `lib/feed-video/*`; `config.ts` styles become `stylesFor(...)`.
- [ ] **Step 5: Run** the selftest (PASS) and `npx tsx --env-file=.env.local scripts/feed-video/feed-video.ts publish --only 1175` - Expected: `1175: already live` (same hash, same file)
- [ ] **Step 6: Commit** `refactor(feed-video): the rules move to lib/feed-video, the hand tool imports them`

### Task 2: One renderer, measured on Vercel (the spike - STOP after it)

**Files:**
- Create: `lib/services/feed-video-render.ts`, `app/api/cron/feedVideoSpike/route.ts`
- Modify: `package.json` (`ffmpeg-static`), `next.config.mjs` (`outputFileTracingIncludes` for the ffmpeg binary on both routes that render), `vercel.json` (functions entry: memory 3009, maxDuration 300), `scripts/feed-video/feed-video.ts` (`renderOne` -> `renderVideo`)

**Interfaces:**
- Consumes: Task 1's `videoHtml` (template), `PrintedVideo`
- Produces: `renderVideo(html: string): Promise<{ mp4: Buffer; ms: number }>` - local Chrome (`LOCAL_CHROME_PATH`, else the Mac path) + system ffmpeg off Vercel; `@sparticuz/chromium` + `ffmpeg-static` on Vercel (`process.env.VERCEL`). Same capture as the hand tool (270x338 CSS px at deviceScaleFactor 4, `PAGE_CHECK`, frame by frame by `currentTime`, JPEG frames piped to ffmpeg, the Global Constraints' encode). Throws with the page's own problems (fonts, pictures, overflowing boxes).
- Produces: `GET /api/cron/feedVideoSpike?only=<id>&line=<text>` - `guardCronRoute` first; plans that one event exactly as the hand tool (live feed row + `config.ts` artist), renders, uploads to `public_resources/creatives/video-spike/<file>` (NEVER `creatives/video/`, never touches `events`), answers `{ id, ms, bytes, url, instance: process.env.VERCEL_REGION + a per-instance random id }`.

- [ ] **Step 1:** Install `ffmpeg-static`; implement `renderVideo`; the hand tool's `render` calls it.
- [ ] **Step 2: Run locally** `npx tsx --env-file=.env.local scripts/feed-video/feed-video.ts render --drafts --only 1174` after deleting its file - Expected: one file; `ffprobe` shows 1080x1350, 10.0 s, h264 + aac
- [ ] **Step 3:** The spike route + `vercel.json` + `next.config.mjs`; `npx tsc --noEmit` clean for the touched files.
- [ ] **Step 4: Commit** `feat(feed-video): one renderer for the Mac and Vercel, and a spike route to measure it`
- [ ] **Step 5: STOP - Dor's push.** After the push and a green Vercel deploy: call the spike once (`curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/feedVideoSpike?only=1174&line=..."`), then 6 at once with 6 ids. Record seconds per video and how many distinct instances answered. **Pass = 80 videos inside one 800 s run.** Report the numbers to Dor; a fail goes back to the spec's fallback list before Task 3.

### Task 3: Tables + the seed (no Claude call)

**Files:**
- Create: `supabase/migrations/<npm run db:new feed_videos>.sql`, `scripts/feed-video/seed.ts`

**Interfaces:**
- Produces (SQL): `artists.feed_video_enabled boolean not null default false`, `artists.feed_video_photos jsonb not null default '[]'`, `artists.feed_video_cutout_in_c boolean not null default true` (three-step add per the migrations rule); table `public.feed_videos` with the spec's columns, `event_id integer primary key references events(id)`, RLS on, no policies, `revoke all ... from anon, authenticated`.
- Produces: `npx tsx --env-file=.env.local scripts/feed-video/seed.ts [--apply]` - the four artists' settings from `config.ts`; one row per line of `state.json` (line, status, `line_by`, style from the plan, `printed` + `video_hash` + `video_path` only where today's file exists in `.superpowers/feed-video/out/`, uploaded); 1175's row `approved`, its approver Dor. Dry run prints what it would write.

- [ ] **Step 1:** Write the migration; idempotent (`if not exists`).
- [ ] **Step 2:** Write the seed; run it dry - Expected: 4 artists, 80 rows, 1 approved.
- [ ] **Step 3: Commit** `feat(feed-video): artists' video switch + the feed_videos table, and a seed from the hand tool`. The migration and `seed --apply` wait for the next push (push lock for `--apply`).

### Task 4: The line writer - agent #4

**Files:**
- Create: `lib/agents/feed-video-lines.agent.ts`, `lib/services/feed-video-lines.ts`
- Modify: `lib/agents/types.ts` (`AGENT_KEYS` + `"feed-video-lines"`), `lib/agents/index.ts`, `scripts/agents-selftest.ts` (four keys)

**Interfaces:**
- Produces: `writeLines(artist: { id: number; name: string }, shows: { eventId: number; place: string; date: string }[], taken: string[], budget: AgentBudget): Promise<{ lines: Map<number, string>; refused: { eventId: number; why: string }[]; costUsd: number }>` - one call, requested tool `lines` (`answerWithTool`, `tool_choice: auto`), `effort: "low"`, `maxRetries: 0`; each answer through `lineProblem` (a refused line = no line, retried on a later run); an `agent.call` audit row with cost. Switch `FEED_VIDEO_AI`, default model `claude-opus-5-5`. `learnsFrom`: `feed_video.line_rewritten` -> "<the AI's line> -> <the person's line>".

- [ ] **Step 1:** Extend `scripts/agents-selftest.ts`: four registered keys; the lesson formatter of `feed_video.line_rewritten` returns the one-line lesson and null for a row with no `from` / `to`. Run - FAIL.
- [ ] **Step 2:** Declare the agent, register it, implement `writeLines`. Run the selftest - PASS.
- [ ] **Step 3: Commit** `feat(agents): agent #4 writes the feed videos' opening lines, once per show`

### Task 5: The run before each publish

**Files:**
- Create: `lib/feed-video/run-plan.ts` (pure), `lib/services/feed-video-run.ts` (I/O), `app/api/cron/feedVideos/route.ts`, `app/api/feed-video/render/route.ts`
- Modify: `vercel.json` (cron `30 4,7,10,13,16,19 * * *`; both functions memory 3009; cron maxDuration 800, render route 300), `scripts/feed-video-selftest.ts`

**Interfaces:**
- Produces (pure): `decideEvent(x: { enabled: boolean; killed: boolean; held: string[]; row: FeedVideoRow | null; expectedFile: string | null; currentUrl: string | null; expectedUrl: string | null }): { needsLine: boolean; takeDown: boolean; render: "approved" | "preview" | null; swapTo: string | null }`
  - hand video (`currentUrl` not system) -> never takeDown, never swapTo
  - switched off / killed / held / line not approved -> takeDown when the current URL is ours
  - price moved (current is ours, not today's file) and approved -> render "approved", NO takeDown
  - pending line with no file ever rendered -> render "preview"; with a file of any older price -> null
  - today's file exists and approved, current differs -> swapTo
- Produces: `artistFeedLabel(a: { name: string; name_english: string | null }, tags: { slug: string; name: string }[]): string | null` (pure) - the feed's `custom_label_2` of the artist: `slugify(name_english)` when a tag has that slug, else the slug of the tag with the artist's Hebrew name; selftest with Oasis -> "oasis", Celine Dion -> "celine-dion", U2 -> "u2".
- Produces: `runFeedVideos(opts: { dryRun: boolean; only?: number[]; budgetMs: number }): Promise<RunReport>` - prints the price only while `FEED_VIDEO_PRICE` is not `off`; `POST /api/feed-video/render` `{ eventId }` with the cron bearer -> renders, uploads, writes the row, swaps the URL only under the swap rule; the cron fans out 6 at a time, stops starting renders 60 s before its budget, deletes superseded files older than 7 days, mails `NEXT_SECRET_ADMIN_EMAIL` once when renders failed.

- [ ] **Step 1:** Selftest cases for every `decideEvent` bullet above (Review Focus 1 and 4 among them). Run - FAIL.
- [ ] **Step 2:** Implement `decideEvent`; selftest PASS.
- [ ] **Step 3:** Implement the service, the two routes and `vercel.json`. `?dry_run=1` = report only (no write, no Claude, no render); `?only=`.
- [ ] **Step 4: Commit** `feat(feed-video): the run before each feed publish - lines once, render, swap`

### Task 6: The check at the feed publish

**Files:**
- Create: `lib/feed/feed-video-check.ts`
- Modify: `lib/feed/publish-meta-feed.ts` (step 0 + the after-fetch compare), `scripts/feed-video-selftest.ts`

**Interfaces:**
- Produces: `staleSystemVideos(rows: { eventId: number; url: string }[], expected: Map<number, string>): number[]` (pure); `mismatchedInFeed(csv: string, printed: Map<number, string /* price text */>): number[]` (pure, reads `id`, `price`, `video[0].url`); `checkFeedVideos(): Promise<{ takenDown: number[]; failedClosed: boolean }>` - on any read error: one update nulling every system video URL, `failedClosed: true`, never throws.
- `publishMetaFeeds`: `checkFeedVideos()` first; after the activities fetch, `mismatchedInFeed` -> null those URLs and fetch the activities file once more; the result gains `videosTakenDown: number[]`.

- [ ] **Step 1:** Selftest: a stale file is listed; a hand URL never; a CSV row whose price disagrees with its video's printed price is listed; a CSV with no video column lists nothing. Run - FAIL.
- [ ] **Step 2:** Implement; selftest PASS. Review Focus 2: a test-only injected reader that throws -> `failedClosed` true and the null-all update issued.
- [ ] **Step 3: Commit** `feat(feed): the feed publish takes down any video whose price no longer matches`

### Task 7: The event editor stops writing a system video back

**Files:** Modify: `lib/actions/event-actions.ts` (`updateEvent`)

- [ ] **Step 1:** In `updateEvent`, drop `campaign_video_url` from the write when the stored value is a system video and the sent value is that same URL or empty (the stale-tab trap, beside the light columns); a different non-system URL saves and wins.
- [ ] **Step 2:** `npx tsc --noEmit` clean; commit `fix(events): a form save never writes back the system's feed video`

### Task 8: Artist editor - the switch and the pictures

**Files:** Modify: the artist editor under `app/(dashboard)/templates/artists/[id]/`, `lib/actions/template-crud.ts` (or the artists actions) so the three columns save explicitly.

- [ ] **Step 1:** "וידאו בפיד" switch (disabled with the reason when `stylesFor` gives none), a pick of photos (in order) from `image_url` + `gallery` + `event_gallery`, "גזיר בסגנון ההופעה" switch, and the line "הסגנונות: A / B / C" from `stylesFor`. Turning on audits `feed_video.artist_enabled`.
- [ ] **Step 2:** tsc clean; commit `feat(artists): a feed-video switch and its pictures`

### Task 9: /meta-feed - the "סרטונים" tab

**Files:**
- Create: `lib/actions/feed-video-actions.ts`, `app/(dashboard)/meta-feed/feed-videos-panel.tsx`
- Modify: `app/(dashboard)/meta-feed/page.tsx` (`UrlTabs`: "פיד" | "סרטונים", `?tab=videos`)

**Interfaces:**
- Produces (all `requireAdmin()`, one load action): `listFeedVideos(): Promise<FeedVideoScreen>`; `approveLine(eventId)`, `approveArtist(artistId)`, `rewriteLine(eventId, line)` (runs `lineProblem` against every other line; a typed line is approved; audits `feed_video.line_rewritten` with from / to), `writeAgain(eventId)` (one `writeLines` call; refuses when `FEED_VIDEO_AI` is off).

- [ ] **Step 1:** Selftest (Review Focus 5): `rewriteLine`'s pure check refuses a 9-word line and a duplicate, in Hebrew.
- [ ] **Step 2:** The panel: one row per show - video (muted, loop, `preload="metadata"`), line, style, price, place / date, status (live / waiting for approval / held - why / rendering / failed - why), the four buttons.
- [ ] **Step 3:** tsc clean; commit `feat(meta-feed): the videos tab - approve, rewrite, write again`

### Task 10: Words + go-live

**Files:** Modify: `CLAUDE.md` (a "Feed videos" block + the cron + env vars `FEED_VIDEO`, `FEED_VIDEO_AI`, `FEED_VIDEO_AI_MODEL`, `FEED_VIDEO_PRICE`), `app/(dashboard)/guide/guide-content.ts` (the videos tab and the artist switch, both languages), `docs/superpowers/plans/2026-11-12-feed-video-go-live.md` (the in-system steps)

- [ ] **Step 1:** Write them; `npx tsx scripts/guide-selftest.ts` PASS.
- [ ] **Step 2: Commit.** Go-live order after Dor's push: migration green -> `seed --apply` (push lock) -> `?dry_run=1` on prod -> `FEED_VIDEO_AI=on` -> one real run -> the next publish shows `videosTakenDown` and the feed's video rows.
