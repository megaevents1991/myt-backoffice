# MYT Conventions (always-on) - myt-backoffice

Quick repo-wide musts. Tech depth lives in `standards/` (TS/React/Next/Supabase).

- **Stack:** Next 15 App Router, React 19, TypeScript, Tailwind, shadcn/ui (Radix).
- **Auth:** cookie-based `session` check in `middleware.ts` (not Supabase SSR).
- **Server Actions** (`lib/actions`) preferred over API routes for dashboard mutations.
- **Crons** secured by `?key=` query secret; defined in `vercel.json`.
- **Soft deletes:** `is_deleted` = date string `"MM-DD-YYYY"`. Never hard-delete events.
- **shadcn/ui - don't reinvent** existing primitives. No new UI libs.
- **Build ignores TS/ESLint errors** (next.config) - `tsc --noEmit` is the real type gate.
- Uses **npm** (`npm run dev/build/lint`), not yarn.
- Conventional commits. **Never** add an AI co-author line.
- **Never push unprompted.** Commit if asked, then stop and report - a push waits for Dor to say "push" / run `/commit-push`. Enforced by `.claude/hooks/guard-push.js`: it reads Dor's last message and blocks `git … push` outright unless he asked for it (when he did, the push runs with no prompt).
