# AGENTS.md - myt-backoffice (engineer & agent onboarding)

Coding patterns for this repo. Read this + the always-on rules in `.claude/rules/` before
writing code. Full architecture in `CLAUDE.md`. New engineer? Run `/onboard`.

## What this app is

Admin dashboard + cron sync engine. Ingests external providers, manages events, sets base
prices, handles reservations. Writes the Supabase data `../myt-main` reads.

## Golden patterns

- **Mutations** → Server Actions in `lib/actions` (preferred over API routes).
- **Cron / sync route** → `app/api/<sync>/route.ts`, **guard `?key=` first**, then sync;
  add the schedule to `vercel.json`. Wrap provider calls in `try/catch`. Map provider fields
  explicitly into the canonical `events` shape.
- **DB writes** → shared service-role client, server-side only, explicit columns, soft-delete
  via `is_deleted` date string. Never hard-delete events.
- **Prices** → set base + per-currency markups (USD+40/EUR+40/GBP+35/ILS+150); the main app
  adds the final 175. See `.claude/rules/pricing.md`.
- **UI** → shadcn/ui (Radix) primitives in `components/ui/`, Tailwind layout. Server Components
  by default.
- **Auth** → cookie `session` via `middleware.ts` (not Supabase SSR).
- **Types** → `types/app.types.ts`; keep synced with main (`/sync-types`).

## Don'ts

- No `any`, no `React.FC`/class components, no new UI libs, no hardcoded exchange rates,
  no client-exposed secrets, no hard-deletes, no AI co-author in commits, no unguarded cron route.

## Before you push

1. `/review-my-code` (or `/review`) 2. `/cron-review` if you touched a sync/cron
2. `/sync-types` if types changed 4. `tsc --noEmit` 5. Feature branch, never commit to `main`.

## Useful commands

`/bo-review` `/ts-review` `/react-review` `/nextjs-review` `/supabase-review` `/cron-review`
`/review` `/onboard` `/review-my-code` - plus global `/new-provider-sync`, `/sync-types`,
`/price-audit`, `/deploy-check`.
