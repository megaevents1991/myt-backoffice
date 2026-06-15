Review the specified file(s) for TypeScript best practices.

Audit each file against `@.claude/rules/standards/typescript.md` (single source of truth).
Check shared types stay in `types/app.types.ts` and synced with main (`@.claude/rules/cross-project.md`).

Output per file: each rule **PASS** or **FAIL [line X]** + a one-line fix.

$ARGUMENTS
