# Data Model Rule (always-on) — myt-backoffice

The backoffice owns event ingestion. Respect the schema the main app reads.

- **Soft deletes only:** `is_deleted` = date string `"MM-DD-YYYY"`, never boolean, never a hard
  DELETE on events.
- **`EventType`** values (incl. backoffice-only `sports_live_event_dynamic`):
  `sports_event, music_event, sports_event_dynamic, sports_live_event_dynamic,
  music_live_event_dynamic, tx_event`. New type → update `types/app.types.ts` and coordinate
  with main (`/sync-types`).
- **Provider source tables** feed `events` (Sports / LIVE / P1 / TixStock / LiveTickets / XS2Event).
  Map provider fields explicitly into the canonical `events` shape — don't pass raw provider rows.
- Prices from sports events stored in **cents**. Currency markups per `@.claude/rules/pricing.md`.
- `vercel.json` defines the cron jobs that drive syncs — keep cron routes and `vercel.json` in sync.
