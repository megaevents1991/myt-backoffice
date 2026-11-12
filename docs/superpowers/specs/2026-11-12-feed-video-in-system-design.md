# Feed videos inside the system - design (2026-11-12)

Dor, 11.11: short videos in the Meta product feed (the Mega Events **activities** catalog), only for the artists
staff switch on, so every catalog campaign can show video without hand work. On 11.11 a hand-run tool was built
(`scripts/feed-video/`); on 12.11 Dor ruled that the system makes them - "לא אמרנו שזה ייצר סרטונים בתוך
המערכת?" - with no one running a script on a Mac. This document is that system.

## What is decided (Dor, 11-12.11)

- **Who:** a switch per artist, "וידאו בפיד", default **off**. Only events of a switched-on artist get a video.
- **What a video shows:** the artist's picture(s), the city and the date, the package price (the site card price
  - the same number the catalog row carries), the Mega Events logo. 10 seconds, 4 beats, 1080x1350, H.264 + a
  silent AAC track. **No music** for now (a licence per track would have to be recorded first).
- **The opening line:** Claude writes a different line per show. It is written **once per show and kept** -
  "משפט לכל וידאו פעם אחת מספיק". A price change renders a new video with the SAME line: no tokens. Claude is called
  only for a show that has no line yet (a new event, or an artist switched on).
- **Approval:** Tom or any admin approves each line before its video goes up. Until then the event stays
  image-only in the feed.
- **Styles:** A (poster in motion), B (fast Reels cuts), C (concert atmosphere) - drawn **once per event**, among
  the styles the artist's pictures can carry, and kept. The point is variety and an A/B comparison.
- **The price stays in the video, and a moved price gets a new video.** Until the new one exists the old one comes
  DOWN, so the ad falls back to its image and never shows a wrong price.
- **When it runs:** before each feed publish (the feed goes to Meta six times a day), not hourly.

## What exists today

- `scripts/feed-video/` (local, committed, unpushed): `config.ts` (four artists + their pictures, hand-written),
  `template.ts` (the three styles as HTML/CSS), `feed-video.ts` (plan / lines / approve / set-line / render / review /
  publish / clear). Its state (80 lines, all from Claude; 1175's approved by Dor 12.11) is
  `.superpowers/feed-video/state.json`, its videos `.superpowers/feed-video/out/` (both gitignored, on Dor's Mac).
- **Event 1175 (Oasis, Manchester, 06.06.2027) is live since 12.11 10:03 UTC** - the first video in the feed, the
  test with Itai.
- myt-main already emits `video[0].url` from `events.campaign_video_url` (`lib/feed/activitiesCatalog.ts`,
  `isDirectVideoUrl`); the column header appears only when some event has a video. Nothing changes in main.
- The event editor has a hand field for the same column (`components/campaign-video-field.tsx`, bucket
  `campaign_videos`). **A video uploaded by hand always wins** - the system never replaces it.

## Measured (11-12.11)

- **Prices drift $2-4 a day** (exchange rates; e.g. 618 $1,793 -> $1,789, 1176 $1,887 -> $1,884). Between 11.11
  evening and 12.11 morning 55 of 74 videos no longer matched. So nearly every video becomes a new video every day.
- Local render (Apple Silicon, local Chrome, 4 at once): 17-20 s a video, 0.6-5 MB a file.
- **Not measured:** the render time on Vercel; how long Meta takes from a feed update until a new video URL is
  usable on the item (Itai measures it on 1175). If Meta is slow, a new URL every day could keep most videos
  "processing" - that would reopen the price decision, and it is Dor's call.

## Goals, non-goals, anti-goals

- **Goal:** with a switch and an approval, an artist's every show in the feed carries a correct video, with nobody
  running anything.
- **Non-goals:** music; 9:16 (Reels / Stories); the tours companies' feeds; events with no artist (football);
  any call to Meta's API; a video for an event the feed does not carry.
- **Anti-goals (a failure even if it "works"):** a video in the published feed whose price differs from its row's
  price; a Claude call per render; replacing a hand-uploaded video; any change to today's image feed for events
  without a video; a failed video run that stops or delays the feed publish.

## The design

### 1. Data (migration)

- `artists`: `feed_video_enabled boolean not null default false`, `feed_video_photos jsonb not null default '[]'`
  (the photo URLs the video uses, in order - chosen from the artist's own pictures), `feed_video_cutout_in_c boolean
  not null default true`. The cutout is the artist's `art_image_url`. Main never reads these.
- Table `feed_videos` - one row per event, backoffice only (RLS on, no policies, anon / authenticated revoked):
  `event_id` (PK, FK events), `artist_id`, `style` ('A' | 'B' | 'C', no CHECK), `line`, `line_status`
  ('pending' | 'approved'), `line_by` ('ai' | 'person'), `line_at`, `approved_by` (staff id), `approved_at`,
  `printed` jsonb (what the newest video prints: name, place, date, price text, tagline, cta, pictures), `video_hash`,
  `video_path`, `rendered_at`, `render_ms`, `render_error`, `render_attempts`, `updated_at`.
- Every line change is audited (`feed_video.line_written` / `.line_approved` / `.line_rewritten`); a rewrite by a
  person is the line writer's lesson (below).

### 2. Pure rules (`lib/feed-video/`, one selftest)

- `template.ts` - moved from `scripts/feed-video/` as is.
- **Which styles an artist carries:** A needs a cutout; C needs one photo or more; B needs three photos or more (one
  per beat). An artist with none of them is not offered the switch.
- **The style is drawn once** (sha1 of the event id, modulo the eligible styles - the hand tool's draw, so 1175 and
  the other 79 keep theirs) and stored; it is drawn again only if the stored style is no longer eligible.
- **What the video prints** comes from `deriveCreativeDefaults` (`lib/creative/auto.ts`) exactly as the hand tool
  does: city only (`cityOf`), date, `buildPriceText` of `siteCardPrice`, `creativeTagline`, the cta.
- **The hash** = sha1 of everything printed + the line + `TEMPLATE_VERSION`; the file is
  `creatives/video/event-<id>-<style>-<hash10>.mp4` in `public_resources`. Same inputs = same file, so a re-run never
  renders twice and the hand tool's 80 files are reused.
- **Held** (no video, and no Claude call): the site price differs from the live feed row's price; no city; a place
  that still reads like a flight label (the Knebworth row, 1303-1308); the artist's name on the event is not the
  artist's.
- `lineProblem` (3-7 words, at most 34 characters, Hebrew, no numbers / prices / quotes / alcohol / "tonight", no
  repeat) and the line prompt - moved from the hand tool.

### 3. The run - before each feed publish

A cron, `feedVideos`, 30 minutes before each publish (`30 4,7,10,13,16,19 * * *`), `maxDuration` 800:

1. **Read:** the switched-on artists; the rows of main's live activities feed that belong to them (the same read
   the hand tool makes - the feed decides which events exist and their price); the `feed_videos` rows.
2. **Lines, only for shows with none:** one Claude call per artist for its new shows, the lines already used in
   the prompt. Stored `pending`. A run never calls Claude for a show that has a line.
3. **Take down what can never come back:** artist switched off, line no longer approved, event held, `FEED_VIDEO=off`
   -> null at once. A video whose PRICE moved is NOT taken down here: it stays in the column until its new file is
   ready, because only the feed publish (section 4) decides what Meta sees, and it checks every video at that moment.
4. **Render:** every APPROVED event whose today's file does not exist yet. A pending line is rendered ONCE - when it is
   written or rewritten - so the approver sees a video, and is not rendered again for a price drift (no one sees it
   in the feed). Each video is ONE request to an internal render route (its own function, the cron's bearer secret),
   several at a time; the route renders, uploads, updates the row and - only if the line is approved, the event still
   matches, and the event shows no video or one of ours - swaps `events.campaign_video_url` to the new file.
5. **Report:** a healthy run is silent; failed renders mail `NEXT_SECRET_ADMIN_EMAIL` once (the marketing sync's
   rule). `?dry_run=1` = the full report, nothing written, no Claude call, no render; `?only=<ids>` for a spike.

What a run cannot finish waits for the next run. An event goes image-only only when its new video was not ready by
the publish (section 4 takes the old one down then) - never for the whole time between runs.

**Load (measured 11-12.11):** today's four artists = 80 shows, ~55 new videos after a night (exchange rates, the 01:30
base-price sync, the 03:00 TixStock prices), few during the day. The first run of the day carries the bulk. If the
spike shows one run cannot finish ~80 videos, the job ALSO runs at 03:45 UTC for the morning publish - rendering
spends no Claude tokens, which was the reason not to run hourly.

### 4. At the feed publish - correctness never waits for the renderer

`publishMetaFeeds` (the cron and the screen's "Sync now") gets a first step, **browser-free and Claude-free**: for
every event whose `campaign_video_url` is ours, recompute today's file name (the same pure rules, DB reads only);
a mismatch -> null. Then the feed is fetched; every row carrying a system video is compared with what that video prints (its
`feed_videos.printed` price against the row's price) - a mismatch (main can move a price between the check and the
fetch, e.g. our own stock selling out) nulls that event's URL and the feed is fetched once more. Then it is copied as
today. If the check itself fails, every system video is taken down (one update) and the publish goes on - a wrong
price is worse than an image. It never touches a hand-uploaded video.

### 5. The renderer - the one replaceable piece

`lib/services/feed-video-render.ts`: `renderVideo(html) -> mp4 bytes`. On Vercel: `@sparticuz/chromium` +
`playwright-core` (already in the repo), the frame-by-frame capture of the hand tool, `ffmpeg-static` for the
encode (a new dependency, ~75 MB on Linux). Rubik is embedded as a data URL from `app/fonts/rubik.woff2`; the
logo is `Wordmark` rendered to markup. On a Mac the same function runs on local Chrome + system ffmpeg.

**A spike comes first in the plan, before the migration:** a guarded route renders one planned event on Vercel
(`?only=`), uploads it to a spike path and answers the seconds it took; called 6 at once it also shows the real
parallelism (fluid compute may put several requests on one instance). **Pass = 80 videos inside one 800 s run**
(e.g. 60 s a video with 6 truly in parallel). A fail leaves the rest of the design standing and swaps only this
piece (fewer frames, the extra 03:45 run, a GitHub Actions runner, or a scheduled job on a machine of ours).

**Spike result (12.11, `/api/cron/feedVideoSpike`, fra1, 3009 MB = 2 vCPU Xeon 2.5 GHz): PASS.** Chromium from
`@sparticuz/chromium` emulates its GPU with SwiftShader in one process; just capturing a frame cost ~0.48 s. With
Chromium's own CPU compositor instead (`defaultVideoGpu()` = "cpu" on Vercel; its flags dropped, `--disable-gpu`)
the capture is 0.11 s and **a full video takes A 45 s, B 56 s, C 127 s** (was 179 / 198 / 403), the picture
identical to the Mac's frame for frame. ffmpeg's encode is 1-3 s; Chromium starts in ~3 s. Six calls at once landed
on six instances with no slowdown. Drawing at half size and enlarging (`scale=2`) halves C again but softens the
text - not used. So the run renders in **calls of several videos each** (one browser per call, ~8 videos in 800 s at
today's mix of styles), fanned out in parallel - 80 videos are ~10 calls. Rough cost (an estimate from Vercel's
CPU pricing, not a bill): ~75 s of 2 vCPU a video, ~$0.5 per 80 videos.

### 6. Staff screens

- **Artist editor** (Templates -> Artists): "וידאו בפיד" switch, a pick of photos for the video from the artist's
  own pictures (`image_url`, the galleries), "cutout in the concert style", and which styles that gives.
  Switching off takes the artist's videos down at the next run (and at the next publish); its rows and lines stay.
- **/meta-feed -> "סרטונים" tab** (ADMIN_ROLES): one row per show of a switched-on artist - the video playing (once
  rendered), the line, style, price, place and date, status (live / waiting for approval / held - why / rendering /
  failed - why). Approve, approve all of an artist, rewrite (a typed line is approved), "write again" (one Claude
  call, on purpose). Every approval and rewrite audited.

### 7. The line writer is agent #4

`lib/agents/feed-video-lines.agent.ts`, switch `FEED_VIDEO_AI` (opt-in, fails closed, `AI_AGENTS=off` stops it),
the agent layer's budget and cost audit (`agent.call`), `answerWithTool`. It learns from a person's rewrites
(`feed_video.line_rewritten`), quoted as data. Off = shows with no line wait; nothing else stops.

### 8. Housekeeping

- **Retention:** each run deletes files of `creatives/video/` that are neither an event's live video nor its
  today's file and are older than 7 days (Meta may still read a feed copy from before). Without it the daily drift
  adds ~160 MB a day.
- **The event editor:** `updateEvent` stops writing `campaign_video_url` back when the stored value is a system
  video (the stale-tab trap the light columns already have); a hand URL typed in the field still saves and wins.
- **Seeding:** a one-off script copies `state.json` (80 lines, statuses, styles) and `config.ts` (the four artists'
  pictures) into the tables and uploads the rendered files whose hash still matches - no Claude call.
- **The price is behind a switch** (`FEED_VIDEO_PRICE`, default on = Dor's ruling): off, the video prints the
  "טיסה + מלון + כרטיס" / "כרטיס בלבד" line instead of the price and every video renders once per event. Itai's
  measurement on 1175 may make Dor flip it; it is a config change, not a rebuild.
- **Which feed rows belong to an artist:** the feed's `custom_label_2` is the artist's tag slug - matched by rule
  (`slugify(name_english)`, else the tag with the artist's Hebrew name); the "name on the event is not the artist's"
  hold catches a wrong match.
- **Kill switch:** `FEED_VIDEO=off` -> the run takes every system video down and stops; the publish step 0 does
  the same. The hand tool stays for local rendering only.

## Calls made by the writer (12.11, after the builder check) - Dor to check

1. A video whose price moved stays in the column until its new file is ready; the publish check takes it down only
   if the new one missed the publish (instead of taking it down at the start of every run).
2. A pending line's video is rendered once, not kept current - only approved videos follow the price.
3. If one run cannot render the morning bulk, the job also runs at 03:45 UTC (no tokens).
4. The price in the video is behind a switch, default on.
5. The spike (a render route, no migration) goes up first and is measured on prod before the rest is built on it.

## Left to the builder

File layout inside `lib/feed-video/`; the render route's name; how many renders run at once (start with 6);
the exact screen layout; retries per failed render (cap 3, then the row says why).

## Open - Dor's calls

- Meta's processing time per new video URL (Itai, on 1175). If it is long, a video that changes every day may rarely
  be the one Meta serves.
- 9:16; music; the Knebworth location name (1303-1308 wait for it).
