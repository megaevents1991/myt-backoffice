Review the specified file(s) for Supabase best practices.

Audit each file against `@.claude/rules/standards/supabase.md` (single source of truth).
This repo WRITES the data main reads: confirm explicit column mapping, soft-delete via
`is_deleted` date string, and no column changes that break main (`@.claude/rules/cross-project.md`).

Output per file: each rule **PASS** or **FAIL [line X]** + a one-line fix.

$ARGUMENTS
