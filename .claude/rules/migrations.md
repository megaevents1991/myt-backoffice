# Migrations Rule (always-on) - myt-backoffice

This repo owns the schema, and the database is **shared with the live main app**.
Several people write migrations in parallel, so the rules below exist to stop one
person's migration from silently cancelling another's.

## Before writing a migration

- **Merge master first.** `git fetch origin && git merge origin/master`. A branch
  cut before someone else's migration was applied fails with *"Remote migration
  versions not found in local migrations directory"* - the remote history holds
  versions your checkout has never seen.
- **Then** `npm run db:new <name>`, so the timestamp lands after everything
  already applied.

## Version numbers are the identity

- Supabase identifies a migration by its **14-digit prefix alone** - the filename
  after it is a comment. Two branches that stamp the same second collide:
  applying one marks the other's version as done, and it is **skipped forever,
  with no error and a green CI run**.
- Two files sharing a prefix in `supabase/migrations/` is always a bug. Renumber
  the newer one to a timestamp after every applied migration, and update any
  code comment that names the old filename.
- Renaming is safe **only** while a migration is unapplied everywhere. Once it is
  applied, the version is recorded remotely and renaming it orphans the history.

## Applying - from master, never from a branch

- **Merge the PR. That's it.** "Apply DB Migrations" runs automatically on any
  push to master touching `supabase/migrations/**`.
- **Never apply from a feature branch**, by workflow dispatch or by
  `npm run db:push`. The remote migration history is global: applying a version
  that exists only on your branch leaves master unable to push, and everyone
  else blocked behind *"Remote migration versions not found"*. That happened on
  2026-07-29 and needed a manual repair. `scripts/guard-db-push.mjs` blocks the
  local path; the workflow's `allow_non_master` input is the CI equivalent and
  is for repairs only.
- The workflow also fails fast if two migrations share a version prefix.
- Never run `supabase migration repair --status reverted` to clear a history
  error. It marks migrations that really were applied as un-applied while their
  schema changes are still live, so the history lies and the next merge fails.
  Bring the missing migration *files* onto master instead:
  `git checkout <branch> -- supabase/migrations/<file>.sql`.

## Writing the SQL

- **Idempotent**: `add column if not exists`, `create table if not exists`,
  `create or replace function`. The workflow can be re-run.
- To add a NOT NULL column to a populated table, do it in three steps -
  add nullable → backfill → `set default` + `set not null`. `add column if not
  exists ... not null default` silently skips both constraints if the column was
  already created by hand in the dashboard.
- **No CHECK constraint on a column the main app writes** (`partners.type`,
  `partners.commission_type`). A value outside the allow-list would turn a
  data-hygiene rule into a failed customer booking. Validate in the backoffice.
- After applying: `npm run db:types` to regenerate `types/database.types.ts`.

See [[cross-project]] - the main app reads these tables.
