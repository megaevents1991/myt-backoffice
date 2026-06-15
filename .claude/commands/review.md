Local PR-style review of the current branch's changes (the manual "review on each PR" pass).

## Steps
1. Diff vs `main`: `git diff main...HEAD` (+ unstaged). Scope to $ARGUMENTS if given.
2. Audit each changed file against the always-on standards
   (`@.claude/rules/standards/{typescript,react,nextjs,supabase}.md`) and domain rules
   (`@.claude/rules/{pricing,data-model,conventions}.md`).
3. If a cron/sync route changed, run the `/cron-review` checklist on it.
4. **Cross-project impact** (`@.claude/rules/cross-project.md`): types, shared DB columns,
   price chain, or the main-app APIs the backoffice calls. Use the `cross-impact-reviewer`
   agent for a deep pass when types/columns/price are touched.
5. `tsc --noEmit` (build ignores TS errors).

## Output
- Verdict: SHIP / FIX FIRST.
- Findings by file: **FAIL [file:line]** rule + fix.
- "Cross-project" section if main is affected.

$ARGUMENTS
