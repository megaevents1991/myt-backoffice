# Sticky Save Bar — Design

**Date:** 2026-06-25
**Scope:** myt-backoffice (admin UI only). No DB, no shared types, no cross-project impact.

## Problem

Every edit/create page puts its Save button at the bottom of a long form. On big
forms (events, offline-flights, offline-hotels) the user must scroll all the way
down to save. We want a save control that is always reachable once the user has
made a change.

## Solution

A shared **sticky bottom bar** that slides up when the form becomes dirty and
holds **Save** + **Discard**. Plus a **leave-guard** that confirms before
navigating away with unsaved changes. The existing bottom Save buttons are
**kept** (zero risk to existing submit wiring) — the bar is an additional,
always-reachable entry point that calls the same submit handler.

## Decisions (locked during brainstorming)

- **Placement:** sticky bottom bar, fixed to viewport, appears only when dirty.
- **Coverage:** all 8 edit/create domains.
- **Wiring:** prop-driven shared component (no context/magic).
- **Bar actions:** Save + Discard + leave-guard.
- **Old buttons:** keep both (bar + existing bottom buttons).
- **Dirty check (useState forms):** `JSON.stringify(current) !== JSON.stringify(initial)`.
- **Leave-guard confirm:** native browser `confirm()` / `beforeunload`.

## Components

### 1. `components/sticky-save-bar.tsx` (`"use client"`)

Prop-driven, no internal state about the form:

```ts
type StickySaveBarProps = {
  isDirty: boolean        // controls slide-up visibility
  isSaving: boolean       // spinner + disables both buttons
  onSave: () => void      // primary action (same handler as bottom button)
  onDiscard: () => void   // reset form to original
  saveLabel?: string      // default "Save"
  savingLabel?: string    // default "Saving..."
  disabled?: boolean      // e.g. validation gate not satisfied
  disabledReason?: string // tooltip text when disabled
}
```

- Layout: `fixed bottom-0 left-0 md:left-64 right-0 z-40` — full width on mobile,
  offset by the `w-64` sidebar on desktop. Sidebar is `z-30`; Radix Dialog overlay
  is `z-50`, so the bar sits above content but below modals (reservations Dialog).
- Always mounted; slides via `translate-y-full → translate-y-0` so show/hide
  animates. `pointer-events-none` while hidden so it never blocks content.
- Left: "You have unsaved changes". Right: Discard (ghost) + Save (primary,
  spinner when saving, wrapped in Tooltip when `disabled && disabledReason`).

### 2. `hooks/use-unsaved-changes.ts` (`"use client"`)

`useUnsavedChanges(isDirty: boolean)`:

- `beforeunload` listener → browser confirm on refresh / tab close / hard nav.
- Capture-phase `click` listener on in-app `<a>` (sidebar links, "Back" links) →
  `confirm()` before allowing soft navigation.
- `popstate` guard for the browser Back button (App Router has no router events);
  primes one history entry while dirty, re-pushes on cancel. Best-effort.
- No new dependencies.

## Per-page wiring

**react-hook-form pages** — offline-flights (new+edit), offline-hotels (new+edit),
templates: blog (`BlogForm`), artists/football (`PersonForm`), categories (new+edit):

- `isDirty={form.formState.isDirty}`
- `isSaving={isPending || form.formState.isSubmitting}`
- `onSave={form.handleSubmit(onSubmit)}`
- `onDiscard={() => form.reset()}` (reset uses values set by the load-time `reset()`)
- offline-flights: pass `disabled`/`disabledReason` if a validation gate exists.

**useState pages** — events/[id], locations (`location-form`), reservations/[id]/edit:

- Snapshot initial state into a `useRef` at load.
- `isDirty = JSON.stringify(current) !== JSON.stringify(initialRef.current)`.
- `onSave` = existing submit handler; `isSaving` = existing saving flag;
  `onDiscard` = restore state from the ref.

## Files touched

1 new component + 1 new hook + ~11 page/form files (each: 1 import, 1
`useUnsavedChanges` call, 1 `<StickySaveBar/>`, and dirty wiring). Pure UI.

## Out of scope (YAGNI)

- No context provider / global registry.
- No shadcn AlertDialog for the leave-guard (native confirm is enough).
- No removal of existing bottom buttons.
