Project-specific review of YOUR recent (uncommitted) changes before pushing - myt-backoffice.

1. `git diff` (staged + unstaged) to find changes. Scope to $ARGUMENTS if named.
2. Audit changed files against `.claude/rules/` (standards + pricing/data-model/cross-project/
   conventions). Cron/sync route changed → also `/cron-review`.
3. Cross-project risk (`@.claude/rules/cross-project.md`): types, shared columns, price chain.
4. Quick checklist: no `any`, no `React.FC`, soft-delete only, `?key=` guard on cron routes,
   no hardcoded rates, no client-exposed secret, no AI co-author line staged.

Output: **FAIL [file:line]** + fix per finding; end with SHIP / FIX FIRST.

$ARGUMENTS
