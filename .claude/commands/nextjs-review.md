Review the specified file(s) for Next.js 15 App Router best practices.

Audit each file against `@.claude/rules/standards/nextjs.md` (single source of truth).
Next 15 gotchas: `await params`, GET handlers not cached by default. For cron/admin routes
confirm the `?key=` guard.

Output per file: each rule **PASS** or **FAIL [line X]** + a one-line fix.

$ARGUMENTS
