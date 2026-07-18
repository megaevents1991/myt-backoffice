# React 19 Standard (always-on) — myt-backoffice

Non-negotiables for the admin dashboard UI. React 19 + Next 15 App Router + shadcn/ui.

## Component model
- **Server Components by default.** `"use client"` only for hooks/handlers/browser APIs/
  interactive shadcn (Radix) widgets — placed as deep as possible, never on a layout.
- **No `React.FC`, no class components.** Type props inline. React 19: `ref` is a plain prop
  (no `forwardRef`); prefer `useActionState`/`useFormStatus` for dashboard forms, `useOptimistic`
  for snappy table edits.

## State & data
- Local `useState`/`useReducer` for dashboard UI; React Context only where it already exists.
  No global store (no Redux/Zustand).
- **You might not need an Effect** — derive during render; effects only for external sync.
  Always a dep array; clean up subscriptions/timers.
- `useMemo`/`useCallback` only when measured.

## UI
- **shadcn/ui (Radix) — don't reinvent.** Use existing primitives in `components/ui/`.
- Tailwind for layout/spacing. Stable keys in lists (never index for sortable/filterable tables).

## Review output
Per file: each rule **PASS** or **FAIL [line X]** + one-line fix.
