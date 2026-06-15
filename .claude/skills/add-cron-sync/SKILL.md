---
name: add-cron-sync
description: Scaffold a new Vercel cron / sync route in the backoffice — route + vercel.json entry + ?key= guard, matching existing sync patterns. Use when adding a scheduled job or provider sync trigger. Triggers on: new cron, add cron job, new sync route, scheduled job.
---

# Add Cron / Sync Route (myt-backoffice)

For a brand-new ticket PROVIDER, use global `/new-provider-sync` instead — this skill is for
the cron/route plumbing of a scheduled job. Do in order.

## 1. Route
- Create `app/api/<sync-name>/route.ts`. Export the method (usually `GET` for cron).
- **First line of work: guard the secret** — read the `?key=` param and reject (`401`/`403`)
  if it doesn't match the expected secret (e.g. `monthlyAlonSecret`). Copy an existing cron route.
- `await params`/`searchParams` (Next 15). Wrap the sync body in `try/catch`; `console.error`
  before a `500`. Export `maxDuration` if the job is long.

## 2. Schedule
- Add a matching entry to `vercel.json` `crons`: `{ "path": "/api/<sync-name>?key=...",
  "schedule": "<cron expr>" }`. **Route and vercel.json must stay in lockstep.**

## 3. Logic
- Put sync logic in a service/helper, not inline in `route.ts`. Map provider fields explicitly
  into the canonical `events` shape — never persist raw provider rows
  (`@.claude/rules/data-model.md`).
- Writes via the shared service-role client, explicit columns, **soft-delete** (`is_deleted`
  date string), prices per `@.claude/rules/pricing.md` (base + currency markup only; sports in cents).

## 4. Verify
- `/cron-review` + `/supabase-review` on the new route; `/sync-types` if you added/changed types;
  `tsc --noEmit`. Confirm the cron path matches between `route.ts` and `vercel.json`.
