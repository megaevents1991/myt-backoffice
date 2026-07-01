Review the changed or specified files against Mega Events backoffice best practices.

Check all of:
1. **Data model** — soft deletes (`is_deleted` date string, no hard-delete), correct `EventType`,
   explicit provider→`events` field mapping (`@.claude/rules/data-model.md`).
2. **Pricing** — base prices + per-currency markups only; no 175 markup, no premature currency
   conversion (`@.claude/rules/pricing.md`).
3. **Crons/syncs** — `?key=` guard + `vercel.json` in sync (use `/cron-review` for depth).
4. **Auth** — cookie `session` via middleware; secrets server-only.
5. **Cross-project** — types synced, no breaking column/contract change for main
   (`@.claude/rules/cross-project.md`).
6. **Standards** — TS/React/Next/Supabase per `@.claude/rules/standards/`.

For each file: **PASS**/**FAIL** per category; for FAIL give file+line, rule, and fix.

$ARGUMENTS
