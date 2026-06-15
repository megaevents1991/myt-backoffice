# Supabase Standard (always-on) — myt-backoffice

Non-negotiables for DB access. Backoffice WRITES the data main reads. Shared DB.

## Client
- Import the shared client — never `createClient()` inline. Service-role/secret key bypasses
  RLS → **server-side only** (routes, server actions, syncs). Never ship to the client.

## Errors
- Every call returns `{ data, error }` — check `if (error)` before using `data`,
  `console.error(JSON.stringify(error))`, return the right status. Never swallow.

## Queries
- **Explicit selects** (`.select('col1,col2')`) — avoid `.select('*')` on hot paths.
- One row → `.single()` / `.maybeSingle()`. No `data[0]` for single-row queries.
- No raw SQL / `rpc()` unless unavoidable (then a typed Postgres function).

## Writes (the backoffice's main job)
- Map columns explicitly in `.insert`/`.update` — never spread a whole object.
- **Soft delete only:** set `is_deleted` to a date string `"MM-DD-YYYY"`. **Never hard-delete events.**
- `.insert(...).select()` when you need the row back (v2 requires explicit `.select()`).
- Don't rename/drop columns the **main app** reads (`events, partners, flights, hotels`) without
  updating it. See `@.claude/rules/cross-project.md`.

## Review output
Per file: each rule **PASS** or **FAIL [line X]** + one-line fix.
