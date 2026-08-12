# TypeScript Standard (always-on) - myt-backoffice

Non-negotiables for all `.ts`/`.tsx`. Calibrated to MYT conventions.

## Types
- **No `any`.** Use `unknown` + narrow, or define an `interface` for external provider
  responses (XS2Event, P1, TixStock, LiveTickets) - type locally, cast once at the boundary.
- **Shared domain types live in `types/app.types.ts`** - kept in sync with main's
  `lib/app.types.ts`. Extend there; never fork parallel copies.
- **Discriminated unions over casts** (`EventType` etc.) - narrow by discriminant.
- **String unions, not `enum`.** Runtime list → `const X = [...] as const; type X = typeof X[number]`.

## Safety
- `?.` / `??` for possibly-undefined values. **No non-null `!`** without a prior guard.
- **No `as` to silence a mismatch** - fix the type. Prefer `satisfies` for literal checks.

## Inference & utility types
- Infer simple return types; annotate contracts (route handlers, server actions, sync fns).
- `Omit`/`Pick` over re-listing fields.

## Async
- Every `async` fn in `app/api/` and every provider sync wrapped in `try/catch`; log before failing.

## Review output
Per file: each rule **PASS** or **FAIL [line X]** + one-line fix.
