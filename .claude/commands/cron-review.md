Review the specified cron / sync route(s) for backoffice correctness.

Check:
1. **Security** — route guards the `?key=` secret BEFORE any work; rejects otherwise.
2. **vercel.json sync** — the route has a matching cron entry (path + schedule); flag drift.
3. **Provider mapping** — provider fields mapped explicitly into the canonical `events` shape;
   no raw provider rows persisted.
4. **Resilience** — external calls in `try/catch`; partial-failure handling; `maxDuration` set
   for long syncs.
5. **DB writes** — explicit columns, soft-delete via `is_deleted` date string, never hard-delete.
6. **Prices** — base + per-currency markups only; no main-app 175 markup here
   (`@.claude/rules/pricing.md`).
7. **Standards** — `@.claude/rules/standards/nextjs.md` + `supabase.md`.

Output: **PASS**/**FAIL [file:line]** per check + concrete fix.

$ARGUMENTS
