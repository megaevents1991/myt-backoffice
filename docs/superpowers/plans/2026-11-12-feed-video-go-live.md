# Feed videos - first go-live (12.11.2026, with Itai)

Dor 11.11: auto-made 10-second videos in the Meta product feed (the activities catalog), for chosen
artists only. This is the hand-run first version; the per-artist switch, a staff approval screen and
a nightly run come with a spec of their own.

Tool: `scripts/feed-video/` (`config.ts` = the artists and the styles their pictures can carry,
`template.ts` = the three styles, `feed-video.ts` = the commands). Run from the repo root:

```bash
npx tsx --env-file=.env.local scripts/feed-video/feed-video.ts <command>
```

State (lines + approvals) and the rendered videos live in `.superpowers/feed-video/` (gitignored, on
Dor's Mac). Nothing reaches the database or Storage without `--apply`.

## What was prepared on 11.11

- **80 events in the live feed** for Oasis (29), Olivia Rodrigo (21), U2 (20) and Celine Dion (10).
  Every site price equals the live feed's price, every event matched its artist.
- **Style per event, drawn once from its id** among the styles the artist's pictures carry:
  Oasis A / B / C, Celine A / C, Olivia A / C, U2 A only (its one photo is red-carpet, NBC and Golden
  Globes logos behind them). 38 A, 30 C, 12 B. A style comparison means something only inside Oasis
  and Celine / Olivia.
- **An opening line per show**, written by Claude (`claude-opus-5-5`), checked in code (3-7 words, at
  most 34 characters, no numbers / prices / quotes / alcohol, no repeats). All are **pending**: a
  person approves them (Tom or an admin).
- **74 videos rendered** (`.superpowers/feed-video/out/`), 1080x1350, 10 s, 30 fps, H.264 + a silent
  AAC track, ~0.7-6 MB each. `review` writes `.superpowers/feed-video/review.html` - every video
  playing beside its line, style and status.
- **Held: the six Knebworth shows (1303-1308).** Their location row is named
  "נבוורת טיסה ללונדון . בריטניה", and today's IMAGE ad prints exactly that. Fix the location's name
  (Locations screen) and they render like the rest. Their lines are written.

## Tomorrow, in this order

1. **Itai, before anything goes in.** Since Sept 2025 Meta turns "dynamic media" (product videos) ON
   by default for catalog ads, so a running ad may start showing a video without anyone touching it.
   He checks the setting on the running catalog ad sets and decides where video is allowed. He also
   says how Meta refreshes the data source (schedule, and whether "Request update now" is there).
2. **Approve the lines.** Open `review.html`. Then `approve all`, or `approve <ids>` and
   `set-line <id> "<text>"` for the ones a person rewrites (a typed line is approved by itself).
3. **Plan again, render what moved.** Prices move several times a day; a video prints the price, so
   `plan` then `render` re-renders exactly the events whose price (or line) changed since 11.11 - the
   file name carries a hash of everything the video prints.
4. **One event first.** `publish --only <id>` (dry run) -> `publish --only <id> --apply` (uploads to
   `public_resources/creatives/video/`, writes `events.campaign_video_url`). Then publish the feed:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://mega-events-backoffice-mega-events.vercel.app/api/cron/publishMetaFeed`
   (no browser login needed), and check the Storage copy has a `video[0].url` column with that one URL.
   Itai pulls the data source in Commerce Manager: **no errors, the same item count, the video on the item.**
   Activities catalogs taking video is not confirmed in Meta's docs - this step is the test.
5. **The rest.** `publish --apply` (refuses any event whose line is not approved, whose video is
   not rendered for today's data, or whose price differs from the live feed). Publish the feed again.
6. **Rollback at any moment:** `clear --apply` sets `campaign_video_url` back to null on every event
   whose URL is ours; at the next feed publish the video column disappears and the file is byte for
   byte what runs today.

Before step 4: other sessions may push to this repo - take the push lock for the `--apply` steps
(`push-coordinator` skill).

## Open (Dor's calls)

- **The price goes stale.** The image ad redraws by itself when a price moves; these videos do not
  until someone runs `plan` + `render` + `publish` again. Either re-render on every price move (the
  nightly build does it by hash), or videos without a price (`--price off`: the pill says
  "טיסה + מלון + כרטיס").
- **Reels / Stories (9:16)** - only 4:5 is made. Meta picks the video per placement when an item has
  several (`video[1].url` ...).
- **Music** - none yet; a licence per track has to be recorded first.
- **Olivia's photo** is 650x717 - soft at full size, fine on a phone. Her stage outfit shows the midriff;
  Meta's review may be stricter with it than with the image ad.
- **U2's name** prints as the site has it: "יו 2".
