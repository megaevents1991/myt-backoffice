# Ticket-Only Events (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An event can be marked "ticket only" in the backoffice; the site then sells the ticket alone (no flight step, no hotel step, price = ticket + `ticket_only_markup`) and shows it as such on the card, in search and in the feeds.

**Architecture:** One new column, `events.package_mode` (`'package'` default | `'ticket_only'`). Backoffice: a switch in the event editor that also zeroes the flight/hotel bases (so every existing `base > 0` gate - base-price sync, "our offer", alternatives, package light - skips the event with no new code) and makes `ticket_only_markup` required. Main: `isTicketOnlyEvent()` forces both skips, jumps step 1 → 4, hides flight/hotel UI, prices through the existing `isTicketOnlyOverride` path, and `confirm-order` rejects any flight/hotel on such an event.

**Tech Stack:** Next 15 / React 19 / TypeScript, Supabase (SQL migration), shadcn (backoffice), Mantine+Tailwind (main). Backoffice selftests run with `npx tsx scripts/<name>.ts`.

**Spec:** `docs/superpowers/specs/2026-09-20-lodging-destinations-design.md` (part A; v2 answers 1-3: badge only, shows in sliders as usual, `package_mode` stays text).

## Global Constraints

- Backoffice work lands on `master` (Dor 22.09). Main work lands on branch `feat/ticket-only-events` off `main`; PR, no merge locally.
- Deploy order: backoffice (migration) first, then main. An older main ignores the column.
- Commit only your own files. This checkout holds another session's uncommitted diff in `lib/services/price-light.ts`, `app/(dashboard)/price-light/comparison-sheet.tsx`, `scripts/price-light-selftest.ts`, `CLAUDE.md`, `app/(dashboard)/guide/guide-content.ts`. **Never `git add -A`.** For `CLAUDE.md` / `guide-content.ts` (touched in Task 7) check `git diff <file>` first; if the foreign hunks are documentation-only, commit the two files whole and say so in the commit body.
- Never push. Dor pushes.
- No `CHECK` constraint on `package_mode` (a third value later needs no migration). Validate in the backoffice.
- Hebrew customer copy exactly: badge `כרטיס בלבד`; card price caption `מחיר` / `לכרטיס` (replacing `מחיר ממוצע` / `לנוסע`); feed text `כרטיס` (no `, טיסה ומלון`).
- Shared type `Event` must stay in sync: `types/app.types.ts` (backoffice) ↔ `lib/app.types.ts` (main).

---

## File map

**Backoffice (master)**
- Create `supabase/migrations/20260923090000_events_package_mode.sql` - the column.
- Create `lib/package-mode.ts` - `PACKAGE_MODES`, `isTicketOnlyEvent`, `ticketOnlyProblems` (pure).
- Create `scripts/package-mode-selftest.ts` - asserts for the pure helpers.
- Modify `types/app.types.ts` - `PackageMode`, `Event.package_mode`.
- Modify `lib/actions/event-actions.ts:15-22` - `EVENT_LIST_COLUMNS` gains `package_mode`.
- Modify `app/(dashboard)/events/[id]/page.tsx` - switch + markup field + save validation + auto-fill guard.
- Modify `app/(dashboard)/events/events-table.tsx:515, 1181, 1265-1279` - filter reads the flag, bulk toggle, badge.
- Modify `app/portal/dashboard-search.tsx:519-595`, `app/portal/packages/new/page.tsx:47`, `app/portal/packages/new/package-wizard.tsx:64-103, 262, ~537` - ticket-only events force the tickets flow.
- Modify `app/(dashboard)/guide/guide-content.ts` - staff guide section.
- Modify `CLAUDE.md` - one paragraph.

**Main (branch `feat/ticket-only-events`)**
- Modify `lib/app.types.ts` - same `PackageMode` + field.
- Modify `lib/events/price.ts` - `isTicketOnlyEvent`, `isTicketOnlyOverride` honours it, `computePackagePrice` branch.
- Modify `app/order/OrderForm.tsx` - force skips, 1 → 4, slots, labels.
- Modify `app/order/layout.tsx:87-93` - 2-step stepper.
- Modify `components/EventCard.tsx`, `components/ui/PackageIcons.tsx`, `components/vertical-hub/HubEventCard.tsx:85`, `components/ClientSideHomepage.tsx:2182` - badge, icon, caption.
- Modify `components/SearchResults.tsx:137`, `components/HeroSearch.tsx:280-288, 519-523` - filter + chips.
- Modify `lib/feed/metaCatalog.ts:223`, `lib/feed/activitiesCatalog.ts:226` - description.
- Modify `app/api/confirm-order/utils.ts` - reject flight/hotel on a ticket-only event (inside `validatePurchasePriceFloor`, which already loads the event ~line 285).

---

### Task 1: Column + shared type + pure helper (backoffice)

**Files:** Create `supabase/migrations/20260923090000_events_package_mode.sql`, `lib/package-mode.ts`, `scripts/package-mode-selftest.ts`; Modify `types/app.types.ts` (~line 88, next to `ticket_only_markup`).

**Interfaces - Produces:** `type PackageMode = "package" | "ticket_only"`; `Event.package_mode?: PackageMode`; `isTicketOnlyEvent(e: { package_mode?: PackageMode | string | null }): boolean`; `ticketOnlyProblems(e: Pick<Event, "package_mode" | "ticket_only_markup">): string[]` (empty = valid).

- [ ] **Step 1: Migration**

```sql
-- Ticket-only events (spec docs/superpowers/specs/2026-09-20-lodging-destinations-design.md, part A).
-- 'package' = today's flow; 'ticket_only' = the site sells the ticket alone (no flight/hotel steps).
-- Text, no CHECK: a later mode (e.g. 'no_hotel') must not need a migration. Validated in the backoffice.
alter table public.events
  add column if not exists package_mode text not null default 'package';

comment on column public.events.package_mode is
  'package | ticket_only. ticket_only: main sells the ticket alone, price = ticket + ticket_only_markup.';
```

- [ ] **Step 2: Shared type** - in `types/app.types.ts` after `EventType` add

```ts
export const PACKAGE_MODES = ["package", "ticket_only"] as const;
export type PackageMode = (typeof PACKAGE_MODES)[number];
```

and after `ticket_only_markup?: number | null;`:

```ts
  /** 'package' (default) = flight + hotel + ticket. 'ticket_only' = the site sells the ticket
   *  alone: no flight/hotel steps, price = ticket + ticket_only_markup (which is then required).
   *  Mirrored in main lib/app.types.ts. */
  package_mode?: PackageMode;
```

- [ ] **Step 3: Failing selftest** `scripts/package-mode-selftest.ts`:

```ts
// Run: npx tsx scripts/package-mode-selftest.ts
import assert from "node:assert/strict";
import { isTicketOnlyEvent, ticketOnlyProblems } from "../lib/package-mode";

assert.equal(isTicketOnlyEvent({ package_mode: "ticket_only" }), true);
assert.equal(isTicketOnlyEvent({ package_mode: "package" }), false);
assert.equal(isTicketOnlyEvent({}), false, "missing column (older row) = package");
assert.equal(isTicketOnlyEvent({ package_mode: null }), false);
assert.equal(isTicketOnlyEvent({ package_mode: "no_hotel" }), false, "unknown future mode is not ticket-only");

assert.deepEqual(ticketOnlyProblems({ package_mode: "package", ticket_only_markup: null }), []);
assert.deepEqual(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: 0 }), [], "0 markup is valid");
assert.deepEqual(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: 45 }), []);
assert.equal(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: null }).length, 1);
assert.equal(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: -1 }).length, 1);
assert.equal(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: Number.NaN }).length, 1);

console.log("package-mode selftest OK");
```

- [ ] **Step 4: Run, expect failure** `npx tsx scripts/package-mode-selftest.ts` → `Cannot find module '../lib/package-mode'`.

- [ ] **Step 5: Implement** `lib/package-mode.ts`:

```ts
import type { Event, PackageMode } from "@/types/app.types";

export { PACKAGE_MODES } from "@/types/app.types";

/** True only for the literal 'ticket_only'. A missing/null/unknown value is the normal package flow. */
export function isTicketOnlyEvent(e: { package_mode?: PackageMode | string | null }): boolean {
  return e.package_mode === "ticket_only";
}

/**
 * Save-time rules for a ticket-only event, as human sentences (empty = valid).
 * The only hard rule today: the site prices it as ticket + ticket_only_markup, so the markup
 * must be a finite number >= 0 (0 is allowed - "sell at cost").
 */
export function ticketOnlyProblems(e: Pick<Event, "package_mode" | "ticket_only_markup">): string[] {
  if (!isTicketOnlyEvent(e)) return [];
  const m = e.ticket_only_markup;
  if (m == null || !Number.isFinite(Number(m)) || Number(m) < 0) {
    return ["Ticket-only event needs a Ticket-Only Markup (USD per ticket, 0 allowed)."];
  }
  return [];
}
```

- [ ] **Step 6: Run selftest** → `package-mode selftest OK`; `npx tsc --noEmit -p . 2>&1 | grep -c "package-mode"` → `0`.

- [ ] **Step 7: Commit** (only these four files)

```bash
git add supabase/migrations/20260923090000_events_package_mode.sql lib/package-mode.ts scripts/package-mode-selftest.ts types/app.types.ts
git commit -m "feat(events): package_mode column + ticket-only helpers"
```

---

### Task 2: Event editor - the switch (backoffice)

**Files:** Modify `app/(dashboard)/events/[id]/page.tsx` - imports; the `skip_flight` card (~2075-2150); the save handler that builds `finalData` (~line 320); the auto-fill effects (~1288-1387).

**Interfaces - Consumes:** `isTicketOnlyEvent`, `ticketOnlyProblems` from `@/lib/package-mode`.

- [ ] **Step 1: Read** lines 300-340, 1280-1390 and 2074-2150 to anchor the edits.

- [ ] **Step 2: Import** `import { isTicketOnlyEvent, ticketOnlyProblems } from "@/lib/package-mode";`

- [ ] **Step 3: Switch + markup field.** Insert BEFORE the `Allow Skip Flight` block:

```tsx
            <div className="space-y-2" id="fix-package-mode">
              <Label htmlFor="package_mode">Ticket only (no flight, no hotel)</Label>
              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="package_mode"
                  checked={isTicketOnlyEvent(event)}
                  onCheckedChange={(on) =>
                    setEvent((prev) =>
                      prev
                        ? {
                            ...prev,
                            package_mode: on ? "ticket_only" : "package",
                            // No travel is sold, so the bases are 0: every base>0 gate
                            // (nightly sync, "our offer", alternatives, package light) then
                            // skips this event on its own.
                            ...(on ? { base_flight_price: 0, base_hotel_price: 0 } : {}),
                          }
                        : prev
                    )
                  }
                />
                <Label htmlFor="package_mode">
                  {isTicketOnlyEvent(event)
                    ? 'Yes - the site sells the ticket alone (badge "כרטיס בלבד")'
                    : "No - regular package"}
                </Label>
              </div>
              {isTicketOnlyEvent(event) && (
                <p className="text-xs text-muted-foreground">
                  Flight/hotel bases, IATA and travel dates are not needed. Ticket-Only Markup below is required.
                </p>
              )}
            </div>
```

Move the `ticket_only_markup` block out of `{event.skip_flight && (...)}` into its own `{(event.skip_flight || isTicketOnlyEvent(event)) && (<div className="space-y-2 pt-2" id="fix-ticket-only-markup"> ...same Input + helper text... </div>)}`; label gains ` *` when ticket-only.

- [ ] **Step 4: Save validation.** In the save handler, right before create/update:

```ts
    const problems = ticketOnlyProblems(finalData);
    if (problems.length) {
      toast({ variant: "destructive", title: "Ticket-only event", description: problems.join(" ") });
      return; // also reset the file's saving flag if it was set above this point
    }
```

- [ ] **Step 5: Auto-fill guard.** First line of BOTH auto effects (nearest-IATA, quote auto-fill): `if (isTicketOnlyEvent(event)) return;` and add `event.package_mode` to their deps.

- [ ] **Step 6: Type-check** `npx tsc --noEmit -p . 2>&1 | grep "events/\[id\]/page.tsx" | head` → nothing.

- [ ] **Step 7: Browser** (preview_start backoffice): flip the switch → bases 0, markup with `*`; save empty → destructive toast; set 45 → saves; reload → still on.

- [ ] **Step 8: Commit** `git add "app/(dashboard)/events/[id]/page.tsx" && git commit -m "feat(events): ticket-only switch in the editor; markup required, bases zeroed, auto-fill off"`

---

### Task 3: Events table + list columns (backoffice)

**Files:** Modify `lib/actions/event-actions.ts:17` → `"tags,skip_flight,package_mode,is_prioritized,is_deleted,"`; `app/(dashboard)/events/events-table.tsx:515, ~1181, ~1265-1279`, name cell.

- [ ] **Step 1: Filter.** Line 515 → `if (showTicketOnly && !isTicketOnlyEvent(event)) return false;` (import from `@/lib/package-mode`). Label ~1181 `Show ticket only events` → `Ticket-only events only`.

- [ ] **Step 2: Bulk toggle** next to the skip_flight bulk items:

```tsx
                <DropdownMenuItem onClick={() => handleBulkUpdate({ package_mode: "ticket_only", base_flight_price: 0, base_hotel_price: 0 })}>
                  Ticket only: ON (bases → 0)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkUpdate({ package_mode: "package" })}>
                  Ticket only: OFF
                </DropdownMenuItem>
```

- [ ] **Step 3: Badge** in the name cell when `isTicketOnlyEvent(row.original)`:

```tsx
<span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
  ticket only{row.original.ticket_only_markup == null ? " · no markup!" : ""}
</span>
```

- [ ] **Step 4: Type-check + eyeball** (filter on → only flagged rows).

- [ ] **Step 5: Commit** `git add lib/actions/event-actions.ts "app/(dashboard)/events/events-table.tsx" && git commit -m "feat(events): ticket-only filter, badge and bulk toggle on the events table"`

---

### Task 4: Partner portal follows the flag (backoffice)

**Files:** `app/portal/dashboard-search.tsx:519-595`, `app/portal/packages/new/page.tsx:47`, `app/portal/packages/new/package-wizard.tsx:64-103, 262, ~537`.

- [ ] **Step 1: Dashboard search.** `const rowTicketsOnly = ticketsOnly || isTicketOnlyEvent(e);` used at 519, 558, 592, 595.

- [ ] **Step 2: Wizard.** `new/page.tsx`: `initialTicketsOnly={ticketsParam === "1" || isTicketOnlyEvent(event)}` + `lockedTicketsOnly={isTicketOnlyEvent(event)}`. `package-wizard.tsx`: prop `lockedTicketsOnly?: boolean` (default false); when true hide the tickets-only toggle, keep both choices `{ mode: "none" }`, the handler at ~262 early-returns, and in the step router (~537) ensure `if (next === 3 && hotelChoice.mode === "none") next = 4;` exists after the flight line.

- [ ] **Step 3: Type-check; open `/portal/packages/new?eventId=<ticket-only id>`** → opens on tickets, no flight/hotel steps.

- [ ] **Step 4: Commit** `git add app/portal/dashboard-search.tsx app/portal/packages/new/page.tsx app/portal/packages/new/package-wizard.tsx && git commit -m "feat(portal): ticket-only events force the tickets flow in the package wizard"`

---

### Task 5: Main - type, pricing helper, order flow (branch)

**Files:** `lib/app.types.ts`, `lib/events/price.ts:55-69`, `app/order/OrderForm.tsx:92, 105-131, 170-173, 219-224, 454, 496-530`, `app/order/layout.tsx:87-93`.

- [ ] **Step 0: Branch** in `myt-main`: `git checkout -b feat/ticket-only-events`.

- [ ] **Step 1: Type** - same `PACKAGE_MODES`/`PackageMode`/`package_mode?` as backoffice Task 1 Step 2.

- [ ] **Step 2: Pricing helpers** in `lib/events/price.ts` (read 1-70 first):

```ts
/** Event-level ticket-only mode (backoffice switch). Missing/unknown = regular package. */
export const isTicketOnlyEvent = (event: Pick<Event, "package_mode">): boolean =>
  event.package_mode === "ticket_only";

export const isTicketOnlyOverride = (event: Event, flightSkipped: boolean, hotelSkipped: boolean) =>
  isTicketOnlyEvent(event) || (flightSkipped && hotelSkipped && getTicketOnlyMarkup(event) != null);
```

`computePackagePrice(event)`: at the top `if (isTicketOnlyEvent(event)) { const t = <file's cheapest-ticket helper>(event); return t == null ? null : Math.ceil(t + (getTicketOnlyMarkup(event) ?? 0)); }`.

- [ ] **Step 3: OrderForm** (read 92-131, 165-235, 440-470, 496-530):
  - after `const isUS` → `const ticketOnly = !!event && isTicketOnlyEvent(event);`
  - hotel preload effect: `if (isUS || ticketOnly) return;`
  - skip-flight init: `if (event?.skip_flight || ticketOnly) setSkipFlight(true);` + new effect `useEffect(() => { if (ticketOnly) { setSkipHotel(true); setHotel(undefined); setFlight(undefined); } }, [ticketOnly, setSkipHotel, setHotel, setFlight]);`
  - `nextUnresolvedStep`: first line `if (ticketOnly) return 4;`
  - US step-3 guard: `(isUS || ticketOnly) && step === 3`; twin: `if (ticketOnly && step === 2) setStep(4);`
  - `continueSlots`: flight slot only when `!ticketOnly`; hotel slot `if (!isUS && !ticketOnly)`.
  - `flowComplete`, `editReturnActive`: `|| ticketOnly` beside `flightSkipped` and beside `isUS`.
  - `skipAction`: `ticketOnly ? undefined : (...)`.

- [ ] **Step 4: Stepper** `app/order/layout.tsx:87-93`: `const ticketOnly = !!event && isTicketOnlyEvent(event);` → `steps={ticketOnly ? ["כרטיסים", "סיום"] : isUS ? ["כרטיסים", "טיסה", "סיום"] : undefined}`, `currentStep={ticketOnly ? (step === 4 ? 2 : 1) : step}`; `handleStepperClick`: when `ticketOnly`, index 0 → `setStep(1)`, 1 → `setStep(4)`.

- [ ] **Step 5: Type-check** `npx tsc --noEmit -p . 2>&1 | grep -E "OrderForm|order/layout|events/price|app.types" | head` → nothing.

- [ ] **Step 6: Browser** `/order/<ticket-only id>` → 2-step stepper, ticket → "בחר והמשך לסיכום" → summary without flight/hotel, total = (ticket + markup) × qty. Regular event unchanged.

- [ ] **Step 7: Commit** `git add lib/app.types.ts lib/events/price.ts app/order/OrderForm.tsx app/order/layout.tsx && git commit -m "feat(order): ticket-only events skip flight and hotel steps, priced ticket + markup"`

---

### Task 6: Main - card, search, feeds, server guard (branch)

**Files:** `components/ui/PackageIcons.tsx`, `components/EventCard.tsx:67-75, 112`, `components/vertical-hub/HubEventCard.tsx:85`, `components/ClientSideHomepage.tsx:2182`, `components/SearchResults.tsx:137`, `components/HeroSearch.tsx:280-288, 519-523`, `lib/feed/metaCatalog.ts:223`, `lib/feed/activitiesCatalog.ts:226`, `app/api/confirm-order/utils.ts` (~285).

- [ ] **Step 1: PackageIcons** - read; add `ticketOnly?: boolean` → renders only the ticket icon.

- [ ] **Step 2: EventCard** - `const ticketOnly = isTicketOnlyEvent(event);` captions `{ticketOnly ? "מחיר" : "מחיר ממוצע"}` / `{ticketOnly ? "לכרטיס" : "לנוסע"}`; badge beside `<EventStatusBadge>`:

```tsx
{ticketOnly && (
  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold text-foreground">כרטיס בלבד</span>
)}
```

`<PackageIcons cycle ticketOnly={ticketOnly} />`. `HubEventCard.tsx:85`, `ClientSideHomepage.tsx:2182`: `{isTicketOnlyEvent(ev) ? "לכרטיס · כרטיס בלבד" : "לנוסע · כולל טיסה, מלון וכרטיס"}` (use each site's event variable).

- [ ] **Step 3: Search + hero.** `SearchResults.tsx:137` → `if (ticketOnly && !(e.skip_flight || isTicketOnlyEvent(e))) return false;`. `HeroSearch.tsx:284-285` → `disabled: !!selected.skip_flight || isTicketOnlyEvent(selected)` (flight, hotel); `:519` → condition `(selected.skip_flight || isTicketOnlyEvent(selected))`, text `{isTicketOnlyEvent(selected) ? "כרטיס בלבד" : "אפשרות לכרטיס בלבד"}`.

- [ ] **Step 4: Feeds** both: `isTicketOnlyEvent(event) ? "" : event.skip_flight ? " ומלון" : ", טיסה ומלון"` (read the template so it still reads `כרטיס ל…`).

- [ ] **Step 5: Server guard** in `validatePurchasePriceFloor` after the event resolves (read the function's return contract - it returns an error string or null - and mirror it):

```ts
  if (isTicketOnlyEvent(event)) {
    const has = (o: unknown) => !!o && typeof o === "object" && Object.keys(o as object).length > 0;
    if (has(data.flight_order_info) || has(data.hotel_order_info)) return "ticket_only_event_with_travel";
  }
```

- [ ] **Step 6: Type-check; browser:** card badge + single icon + "מחיר / לכרטיס"; search filter includes it; feed line has `כרטיס` without `טיסה`.

- [ ] **Step 7: Commit** `git add components/ui/PackageIcons.tsx components/EventCard.tsx components/vertical-hub/HubEventCard.tsx components/ClientSideHomepage.tsx components/SearchResults.tsx components/HeroSearch.tsx lib/feed/metaCatalog.ts lib/feed/activitiesCatalog.ts app/api/confirm-order/utils.ts && git commit -m "feat(events): ticket-only badge, single icon, search and feed wording; confirm-order rejects travel on ticket-only events"`

---

### Task 7: Staff guide + CLAUDE.md (backoffice)

- [ ] **Step 1: Guide section** in `GUIDE_SECTIONS` after `events` (match the `GuideSection`/`GuideFlow`/`GuideFlowStep` shapes at lines 10-40):

```ts
  {
    id: "ticket-only",
    title: { en: "Ticket-only events", he: "אירועי כרטיס-בלבד" },
    summary: {
      en: "An event sold as a ticket alone - no flight, no hotel. The site skips both steps and prices ticket + Ticket-Only Markup.",
      he: "אירוע שנמכר ככרטיס בלבד - בלי טיסה ובלי מלון. האתר מדלג על שני השלבים והמחיר הוא כרטיס + Ticket-Only Markup.",
    },
    flows: [
      {
        title: { en: "Mark an event ticket-only", he: "סימון אירוע ככרטיס-בלבד" },
        steps: [
          { en: 'Events → open the event → Pricing card → switch "Ticket only (no flight, no hotel)" ON.', he: 'אירועים ← פתיחת האירוע ← כרטיס Pricing ← מתג "Ticket only" דלוק.' },
          { en: 'Flight/hotel bases drop to 0 and the nightly syncs skip the event. Fill "Ticket-Only Markup" (required, 0 allowed) and save.', he: 'מחירי הבסיס של טיסה/מלון יורדים ל-0 והסנכרונים הליליים מדלגים על האירוע. ממלאים "Ticket-Only Markup" (חובה, 0 מותר) ושומרים.' },
          { en: 'On the site: card badge "כרטיס בלבד", ticket icon only, "מחיר לכרטיס"; order flow = tickets → summary. Feeds say "כרטיס" only.', he: 'באתר: תגית "כרטיס בלבד" על הכרטיס, אייקון כרטיס בלבד, "מחיר לכרטיס"; ההזמנה = כרטיסים ← סיכום. הפידים אומרים "כרטיס" בלבד.' },
          { en: 'Events table: filter "Ticket-only events only"; bulk menu switches several events (then set each markup).', he: 'טבלת האירועים: פילטר "Ticket-only events only"; תפריט bulk מחליף כמה אירועים (ואז ממלאים markup לכל אחד).' },
        ],
      },
    ],
    links: [{ label: { en: "Events", he: "אירועים" }, href: "/events" }],
  },
```

- [ ] **Step 2: CLAUDE.md** after the "Event Creation Flow" paragraph:

```md
**Ticket-only events (2026-09-23, spec `docs/superpowers/specs/2026-09-20-lodging-destinations-design.md` part A).** `events.package_mode` text (`package` default | `ticket_only`, no CHECK; helpers in `lib/package-mode.ts`, mirrored in main `lib/events/price.ts`). The editor switch zeroes `base_flight_price`/`base_hotel_price` and requires `ticket_only_markup` - so every existing `base > 0` gate (base-price-sync, price-light-ours, alternatives, package light = `na`) skips the event with no code of its own. Main forces both skips, walks 1 → 4 with a 2-step stepper, prices via `isTicketOnlyOverride`, shows the "כרטיס בלבד" badge, and `confirm-order` rejects any flight/hotel on such an event. The portal wizard is locked to tickets. Deploy backoffice (migration) before main.
```

- [ ] **Step 3: Commit** (see Global Constraints about the foreign hunks) `git add CLAUDE.md "app/(dashboard)/guide/guide-content.ts" && git commit -m "docs(events): ticket-only events in the staff guide and CLAUDE.md"`

---

### Task 8: Alon's QA form (artifact)

- [ ] **Step 1:** scratchpad `ticket-only-qa.html`, Hebrew RTL, main brand, pass/fail radios + notes per row:
  1. בקאופיס: מתג "Ticket only" באירוע בדיקה → הבסיסים 0, שדה markup עם *, שמירה בלי markup נחסמת.
  2. טבלת האירועים: הפילטר מציג רק את האירוע, תג "ticket only" בשם.
  3. אתר, כרטיס האירוע (דף הבית + חיפוש): תגית "כרטיס בלבד", אייקון כרטיס בלבד, "מחיר / לכרטיס" = כרטיס + markup.
  4. חיפוש עם "כרטיס בלבד" מסומן: האירוע מופיע.
  5. דף ההזמנה: stepper של 2 צעדים, בחירת כרטיס → "בחר והמשך לסיכום" → סיכום בלי טיסה/מלון ובלי כפתורי "לא צריך".
  6. סה"כ בסיכום = (כרטיס + markup) × כמות, בלי 175.
  7. הזמנת בדיקה עוברת ומופיעה בבקאופיס בלי טיסה/מלון; המייל בלי שורות טיסה/מלון.
  8. פורטל סוכנים: האשף נפתח על כרטיסים, בלי שלבי טיסה/מלון.
  9. אירוע רגיל: הכול כמו קודם (רגרסיה).
  10. פיד מטא: "כרטיס ל…" בלי "טיסה ומלון".
- [ ] **Step 2:** publish (icon `checklist`), add the link to the spec header next to the mockup link, commit the spec.

---

## Self-review

- **Spec coverage (part A):** switch + required markup (T2); automations skipped via bases → 0 (T2); package light `na` (same); table filter (T3); portal locked (T4); card badge + icon + caption (T6); shows in sliders as usual (no filter added); order 1 → 4 (T5); price = ticket + markup, no 175 (existing override, T5); feeds (T6); server rejects travel (T6); guide + CLAUDE.md (T7); QA form (T8); branches (Global).
- **Placeholders:** none - each "read first" names lines and is followed by the code to insert.
- **Type consistency:** `isTicketOnlyEvent`, `ticketOnlyProblems`, `PackageMode`, `PACKAGE_MODES`, `package_mode`, `lockedTicketsOnly` consistent throughout.
