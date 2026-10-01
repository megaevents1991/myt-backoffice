# Tours module (Mega Family) - build brief

Read this fully before writing code. It is the contract between the people (and agents) building the tours module in parallel.

## What we are building

The backoffice becomes multi-company. Mega Events (product type `events`) is live and must keep working exactly as today. Mega Family (product type `tours`) is new: organized trips with dated departures, group flight blocks, an occupancy price matrix, promotions.

The backoffice replaces two spreadsheets the Mega Family team works in today: a Google Sheet that feeds their site (departures, prices, discounts) and an Excel workbook that manages group flight blocks.

Specs (Hebrew, in the sibling repo):
- `../mega-family/docs/plans/MEGA-FAMILY-FUNCTIONAL-SPEC.md` - roles, flows, screens, rules. **This is what the screens must do.**
- `../mega-family/docs/plans/MEGA-FAMILY-DATA-SPEC.md` - data model and the column-by-column mapping.

## Hard rules

1. **Never push. Never commit.** The lead integrates and commits. A push to master deploys the live backoffice and applies migrations to the production database.
2. **Never touch production.** `.env.local` holds PRODUCTION keys. Never run a script with `--env-file=.env.local`, never `supabase db push`, never any `--linked` command. Everything runs against the local Supabase stack (Docker) through `.env.development.local`.
3. **Do not change what Mega Events users see.** When the active company is Mega Events, every existing screen must look and behave as before.
4. **Stay inside your file ownership** (listed in your task). If you need a change in someone else's file, say so in your report - do not edit it.
5. **No schema changes.** Do not edit or add migrations and do not regenerate `types/database.types.ts`. If a column is missing, report it.
6. **Company scope on every query.** The service-role client bypasses RLS. Every tours query filters `.eq("company_id", company.id)` and every write sets `company_id` from the server, never from client input.
7. **No local dev server of your own.** One shared dev server runs on `http://localhost:3100`. It recompiles on save. If a page breaks because of someone else's half-saved file, wait a minute and retry.

## Foundations (already written - use them, do not duplicate)

| File | What it gives you |
|---|---|
| `lib/company.ts` | `requireCompany("tours")` -> `{ session, company }` (staff guard + active company; throws when the active company does not sell tours). `getActiveCompany()`, `MEGA_EVENTS_COMPANY_ID`. |
| `lib/actions/company-actions.ts` | `getCompanyContext()`, `setActiveCompany(slug)` for the top bar. |
| `lib/tours/db.ts` | `toursDb()` = typed client on schema `tours`. Public tables: `supabaseTyped` from `lib/supabase-server`. |
| `types/tours.types.ts` | Row types (`TourDeparture`, `TourSeries`, ...) and every status vocabulary with its Hebrew label (`SALE_STATUS_LABELS`, `BLOCK_STATUS_LABELS`, `BLOCK_STATUS_TRANSITIONS`, `PROMOTION_KIND_LABELS`, `PRICE_MATRIX_ROWS`, ...). |
| `lib/tours/pricing.ts` | `toPriceMatrix`, `pricedRooms`, `cardPrice` - room compositions and prices from the six-row matrix. |
| `lib/tours/routes.ts` | `sameCity`, `routeType`, `departureRouteLabel`, `flightRouteLabel`, `checkBlockFitsDeparture` (two-end city check). |
| DB views | `tours.departure_stats` (allocated_seats, live_blocks, total_blocks, sold, remaining per departure) and `tours.flight_realization` (ordered vs realised per month and airline). |

Tables (schema `tours`): `packages`, `package_itineraries`, `package_terms`, `terms`, `series`, `series_terms`, `departures`, `departure_prices`, `departure_options`, `promotions`, `departure_sales_entries`, `flight_allocations`, `hotels`, `cars`, `instructors`, `cms_pages`, `costings`, `costing_lines`.
Tables (schema `public`, new): `companies`, `company_members`, `company_domains`, `flight_contracts`, `flight_contract_rules`, `flight_block_events`, `calendar_periods`, `company_exchange_rates`, `leads`.
`public.flights` gained `company_id` (default = Mega Events) and the operations columns (`original_quantity`, `cost_child_price`, `cost_tax`, `inbound_airline_code`, `contract_id`, `season_label`, `requested_at`, `first_cancellation_date`, `names_deadline`, `reviewed_at`, `reviewed_by`, `cancelled_at`, `cancel_reason`, `cancellation_fee`, `import_ref`), and `block_status` now allows `approved | requested | declined | option | confirmed | operational | ticketed | cancelled`.

The exact columns are in `types/database.types.ts` (generated) and in `supabase/migrations/20261001*.sql`.

## Conventions (in addition to `.claude/AGENTS.md`)

- Server Actions in `lib/actions/*.ts` (`"use server"`), first line of every action: `const { session, company } = await requireCompany("tours");`. Return `{ success, error? , data? }`; never throw to the client for expected failures.
- Mutations call `logAudit` (`lib/audit.ts`) like the existing actions do.
- Pages under `app/(dashboard)/tours/...`. Use `PageHeader` (`components/page-header.tsx`), shadcn/ui primitives in `components/ui`, Tailwind. No new UI libraries, no `any`.
- **UI language: Hebrew, right-to-left.** The operators are Hebrew speakers. Wrap the page content in `<div dir="rtl">`. Codes, airports, flight numbers and prices stay LTR (`dir="ltr"` on those spans). Dates as `dd.mm.yy`. Use the labels from `types/tours.types.ts`.
- Soft delete: `is_deleted` is a `date` on tours tables (set today's date, never hard-delete departures or packages).
- Lists that can pass 1000 rows must page (`.range`).
- Loading, empty and error states on every screen. Confirm destructive actions with the existing `confirm-dialog` / `confirm-provider`.
- Money: prices are in the departure's currency (`USD | EUR | GBP`), plain numbers (not cents).

## Local environment

- Local Supabase (Docker): API `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. It holds a copy of production data plus the Mega Family import.
- Query the DB:
  `docker exec -i -e PGPASSWORD=postgres supabase_db_myt-backoffice psql -U supabase_admin -h 127.0.0.1 -d postgres -At -c "select ..."`
  (in Git Bash prefix the command with `MSYS_NO_PATHCONV=1`).
- Company ids: Mega Events `a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601`, Mega Family `b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702` (slug `mega-family`).
- Local data: 50 packages (12 with full page content, 38 stubs), 52 series, 231 departures (14 published), 1054 matrix prices, 204 promotions, 623 Mega Family flight blocks, 187 allocations, 504 block events, 8 contracts, 48 calendar periods, 38 Mega Events flights.
  Good samples: departure `CBEA1014` and `FDUA1204` (2026, published, full matrix + fixed discount), `MBUD1015` (vacation kind with hotel and ticket options).
- Screenshot / smoke test a screen while logged in as the local test superadmin:
  `node C:/Users/doraz/myt-db-backups/tools/bo-shot.js 3100 tours/departures C:/Users/doraz/myt-db-backups/tools/<name>.png mega-family [--full] [--wait=3000] [--click="text=..."]`
  It prints the HTTP status, the h1, console errors and failed requests. Pass `mega-family` to work in that company; omit it to see Mega Events. Then open the PNG with the Read tool and look at it.
- Scripts against the local DB: `npx tsx --env-file=.env.development.local scripts/<name>.ts`.

## Definition of done (every workstream)

1. `npx tsc --noEmit -p .` adds **no new errors**. The baseline is 14 pre-existing errors in 9 source files, listed in `C:/Users/doraz/myt-db-backups/tsc-baseline-src.txt` (ignore anything under `.next/`). Run it once near the end (it takes about 3 minutes) and compare:
   `npx tsc --noEmit -p . 2>&1 | grep "error TS" | grep -v "^.next/"`
2. Every screen you built was opened with `bo-shot.js` in company `mega-family`: status 200, no console errors, and you looked at the screenshot.
3. At least one mutation per screen was exercised end to end and the row was checked in the database with psql.
4. Your report lists: files created and changed, what was verified and how, anything not finished, anything you need from another workstream or from the schema.
