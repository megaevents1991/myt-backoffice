# Migrations Rule (always-on) — myt-backoffice

This repo owns the schema, and the database is **shared with the live main app**.
Several people write migrations in parallel, so the rules below exist to stop one
person's migration from silently cancelling another's.

## Before writing a migration

- **Merge master first.** `git fetch origin && git merge origin/master`. A branch
  cut before someone else's migration was applied fails with *"Remote migration
  versions not found in local migrations directory"* — the remote history holds
  versions your checkout has never seen.
- **Then** `npm run db:new <name>`, so the timestamp lands after everything
  already applied.

## Version numbers are the identity

- Supabase identifies a migration by its **14-digit prefix alone** — the filename
  after it is a comment. Two branches that stamp the same second collide:
  applying one marks the other's version as done, and it is **skipped forever,
  with no error and a green CI run**.
- Two files sharing a prefix in `supabase/migrations/` is always a bug. Renumber
  the newer one to a timestamp after every applied migration, and update any
  code comment that names the old filename.
- Renaming is safe **only** while a migration is unapplied everywhere. Once it is
  applied, the version is recorded remotely and renaming it orphans the history.

## Applying

- GitHub → Actions → **Apply DB Migrations** → Run workflow, and pick the
  **branch that holds the migration** in the "Use workflow from" dropdown. It
  defaults to master; the run now fails when nothing is pending rather than
  reporting success for a no-op.
- The run is a **dry run** unless `confirm_apply` is ticked. Read the
  `supabase migration list` output first — it shows local vs remote.
- The workflow fails fast if two migrations share a version prefix, or if master
  has migration commits this branch lacks. `allow_behind_master` overrides the
  second check — reach for it only when you know why.
- Never run `supabase migration repair --status reverted` to clear the error
  above. It marks migrations that really were applied as reverted and corrupts
  the history of a shared database. The fix is to merge master, not to edit the
  history table.

## Writing the SQL

- **Idempotent**: `add column if not exists`, `create table if not exists`,
  `create or replace function`. The workflow can be re-run.
- To add a NOT NULL column to a populated table, do it in three steps —
  add nullable → backfill → `set default` + `set not null`. `add column if not
  exists ... not null default` silently skips both constraints if the column was
  already created by hand in the dashboard.
- **No CHECK constraint on a column the main app writes** (`partners.type`,
  `partners.commission_type`). A value outside the allow-list would turn a
  data-hygiene rule into a failed customer booking. Validate in the backoffice.
- After applying: `npm run db:types` to regenerate `types/database.types.ts`.

See [[cross-project]] — the main app reads these tables.
