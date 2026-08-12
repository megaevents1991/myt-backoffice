Full codebase walkthrough for a new engineer on **myt-backoffice** (admin dashboard + cron
sync engine).

Walk through, reading the real files:

1. **Big picture** - `CLAUDE.md` + `.claude/AGENTS.md`. Two-project platform: this app writes
   the Supabase data `../myt-main` reads.
2. **Always-on rules** - summarize `.claude/rules/` (standards + pricing/data-model/
   cross-project/conventions).
3. **Auth** - cookie `session` check in `middleware.ts` (not Supabase SSR).
4. **Data model** - `db.schema.sql`, `types/app.types.ts`, EventType values, soft deletes.
5. **Provider syncs** - the cron routes under `app/api/`, secured by `?key=`, scheduled in
   `vercel.json`; how providers (Sports/LIVE/P1/TixStock/XS2Event) map into `events`.
6. **Pricing** - base prices + per-currency markups set here; main adds the final 175.
7. **Mutations** - Server Actions in `lib/actions`; shadcn/ui in `components/`.
8. **Workflow** - feature branch, `/review-my-code` + `/cron-review` before push, `/sync-types`
   if types change, never an AI co-author line.

End with: "Use `/new-provider-sync` for a new provider, `/review` before a PR."

$ARGUMENTS
