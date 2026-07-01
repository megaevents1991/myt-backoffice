# Next.js 15 App Router Standard (always-on) — myt-backoffice

Non-negotiables for routes, dashboard pages, crons, middleware. Next 15.

## Next 15 breaking-change watch
- **`params`/`searchParams` are Promises** — `const { id } = await params`. Never sync-read.
- **GET route handlers are NOT cached by default.** Add `export const dynamic = 'force-static'`
  only if a GET is genuinely static; admin/cron data is dynamic.

## API & cron routes
- Named method exports; return `NextResponse.json(...)` with explicit status. Validate early → `400`.
- **Cron routes are secured by a query key** (`?key=...`, e.g. `monthlyAlonSecret`) — every
  cron/admin-trigger route MUST check it before doing work, and reject otherwise.
- Cron schedule + path live in `vercel.json` — keep route and `vercel.json` entry in lockstep.
- Wrap every provider/external call (XS2Event, P1, TixStock, exchange rate) in `try/catch`;
  log before a `500`. Long syncs export `export const maxDuration = ...`.
- Business/sync logic in helpers/services, not inline in `route.ts`.

## Auth & middleware
- Auth is **cookie-based** (`session` cookie) checked in `middleware.ts` — NOT Supabase SSR.
  Don't add heavy logic/data-fetching to middleware (runs every request).

## Server Actions & env
- Prefer Server Actions (`lib/actions`) over API routes for dashboard mutations.
- Secrets server-only; never expose to client. New secret → `.env.local` + document in `CLAUDE.md`.

## Review output
Per file: each rule **PASS** or **FAIL [line X]** + one-line fix.
