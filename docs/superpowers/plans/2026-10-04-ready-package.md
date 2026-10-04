# Ready package Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (superpowers:executing-plans), the night of 2026-10-04. Code bodies are not repeated here - the interfaces and the checks are.

**Goal:** an event can carry ONE house-built package; a click on its card lands the customer on a visual summary of it, with a traveller picker.

**Architecture:** a `house` row in `prepared_packages` holds an identity `spec` and one priced composition per party size (`variants`), built and refreshed in the backoffice through main's own search APIs. Three event columns point at it. Main serves a variant through the existing `/api/package/[id]` route and draws a new showcase component in place of the summary's `<Review>`.

**Tech Stack:** Next.js 15, Supabase, TypeScript. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-ready-package-design.md`

## Global Constraints

- Every event starts `ready_package_mode = 'off'`; nothing in main changes unless a `house` answer set `readyPackage`.
- Partner links (`?pkg=`, `kind = 'partner'`) take the exact path they take today.
- No pricing rule is added or changed: prices come from `computePerPersonPackagePrice` (backoffice) and main's existing order hooks.
- Soft deletes only; map columns explicitly; `requireStaff` + audit on every action.
- Migration is applied by CI on push to master only. Backoffice deploys before main.
- No AI co-author line in commits. Commit by explicit paths.

## File map

Backoffice (`myt-backoffice`):

| File | Responsibility |
|---|---|
| `supabase/migrations/20261004230000_ready_package.sql` | columns on `prepared_packages` and `events` |
| `types/ready-package.types.ts` | `ReadyPackageMode`, `ReadyPackageSpec`, `ReadyVariant`, `ReadyVariants`, `ReadyRefreshStatus` |
| `lib/ready-package.ts` | PURE: `specFromComposition`, `matchFlight`, `matchHotelOption`, `offlineHotelUnitsFor`, `paxOptions`, `summarizeRefresh`, constants `READY_MAX_TRAVELERS_DEFAULT 4`, `READY_MAX_TRAVELERS_CAP 6` |
| `scripts/ready-package-selftest.ts` | selftest of the pure file |
| `lib/services/package-search.ts` | `searchFlightsViaMain`, `searchHotelsViaMain` - the bodies moved verbatim out of the portal actions (which keep their `requirePartner` wrappers) |
| `lib/services/package-snapshots.ts` | `buildHotelSnapshot`, `roomCapacity`, row types and column lists - moved verbatim, imported back by the portal actions |
| `lib/services/ready-package.ts` | `buildVariant(spec, eventId, pax)`, `refreshHousePackage(id, opts)`, `adoptPackage`, `composeAuto` (script), event-column writer |
| `lib/actions/ready-package-actions.ts` | staff actions for the card |
| `app/(dashboard)/events/[id]/ready-package-card.tsx` | the editor card |
| `app/api/cron/ready-package-refresh/route.ts` + `vercel.json` | nightly refresh |
| `scripts/ready-package-create.ts` | compose a preview package without the wizard |
| `lib/actions/event-actions.ts` | `updateEvent` strips the three event columns |
| `types/app.types.ts`, `types/database.types.ts` | new columns |
| guide content, `CLAUDE.md` | docs |

Main (`myt-main`):

| File | Responsibility |
|---|---|
| `lib/app.types.ts` | three `Event` fields |
| `lib/events/readyPackage.ts` + `lib/__tests__/readyPackage.test.ts` | PURE: `readyPackageEntry(event, search)`, `pickVariant` |
| `app/api/package/[id]/route.ts` | house branch: `?pax`, variants, `house` / `pax_options` |
| `app/app.context.ts`, `app/order/layout.tsx` | `readyPackage` state; draft treats it as owned |
| `app/hooks/useHandlePreparedPackage.ts` | token from `?pkg` or the entry rule; `loadPax(n)` |
| `components/order/ReadyPackageShowcase.tsx` | the new view |
| `app/order/OrderReview.tsx` | one condition around `<Review>` |
| `lib/events/price.ts` | card price in `live` |

## Tasks

### Task 1: schema + types (backoffice)
- [ ] Migration (idempotent; `kind` added nullable, backfilled, then default + not null).
- [ ] `types/ready-package.types.ts`, `Event` fields in `types/app.types.ts`, hand-patch `types/database.types.ts`.
- [ ] `updateEvent` strips `ready_package_token`, `ready_package_mode`, `ready_package_price_usd`.
- Check: `npx tsc --noEmit` clean for touched files.

### Task 2: pure rules + selftest (backoffice)
- [ ] `lib/ready-package.ts` and `scripts/ready-package-selftest.ts` (identity extraction from both flight kinds and both hotel kinds; a flight matched by numbers + times and missed when one differs; hotel rate fallback order; unit scaling; pax options; status summary).
- Check: `npx tsx scripts/ready-package-selftest.ts` passes.

### Task 3: search + snapshot services (backoffice)
- [ ] Move the two search bodies and the hotel snapshot builder into services; portal actions import them back.
- Check: `npx tsc --noEmit`; `git diff --stat` shows the portal file only losing the moved bodies.

### Task 4: ready-package service, actions, cron, script (backoffice)
- [ ] Service, actions, cron route + `vercel.json`, create script (`--apply` gated).
- Check: `npx tsx scripts/ready-package-create.ts <eventId>` (dry) prints a composition; cron `?dry_run=1` on dev.

### Task 5: editor card + docs (backoffice)
- [ ] Card in the event editor, guide section text, `CLAUDE.md`.
- Check: card renders on dev (port 3002), `npx tsx scripts/guide-selftest.ts`.

### Task 6: push backoffice, migration, test package
- [ ] push-coordinator protocol, push, watch "Apply DB Migrations".
- [ ] `scripts/ready-package-create.ts <eventId> --apply` -> a `preview` package.

### Task 7: main
- [ ] Pure entry rule + tests, route house branch, context + hook, showcase, `OrderReview` condition, card price.
- Check: `npx vitest run`, `npx tsc --noEmit`, the preview link on dev (desktop + mobile), a regular event and a `?pkg=` link unchanged.

### Task 8: push main, QA form
- [ ] Push main; QA form artifact for Alon with the preview link.
