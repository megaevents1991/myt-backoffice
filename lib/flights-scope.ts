/**
 * The company-scoped door to `public.flights` (server only).
 *
 * The table is shared by every company: Mega Events offline flights and Mega
 * Family group blocks live side by side, told apart by `company_id`. The
 * service-role client bypasses RLS, so the company filter is a code gate - and
 * this file is where it lives. Every event feature and every Offline Flights
 * screen reads and writes flights through it. Code that queries the table
 * itself (the tours module, on the typed client) must carry
 * `.eq("company_id", ...)` in the same statement.
 * scripts/flights-company-scope-selftest.ts scans lib/, app/ and components/
 * and fails on any flights access that does neither.
 *
 * Two scopes, nothing else:
 *   - `megaEventsFlights()`  event features (event links and allocations, the
 *     flight lock, hotel-to-flight linking, portal packages, reservations,
 *     offer details, price syncs). They exist only for Mega Events, whatever
 *     company the operator is working in.
 *   - `flightsOf(company)`   the Offline Flights screens and the tours module:
 *     the ACTIVE company, taken from `requireCompany()` / `getActiveCompany()`
 *     on the server. Never build the company from client input.
 *
 * What a scope gives you:
 *   - `select()`  already filtered by company; chain `.eq("id", ...)` and the
 *     rest as usual. An id of another company finds nothing.
 *   - `insert()`  stamps `company_id` on every row, over whatever the row says.
 *   - `update()`  filtered by company and never moves a row to another company.
 * There is no delete (flights are soft-deleted through `update`) and no upsert.
 */
import { supabase } from "@/lib/supabase-server";
import { MEGA_EVENTS_COMPANY_ID, type Company } from "@/lib/company";

export type FlightScope = Pick<Company, "id">;

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `supabase` is the untyped client (its rows resolve to `never`), so this one
// boundary is cast - the repo pattern for the flights table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from("flights");

export function flightsOf(company: FlightScope) {
  const companyId = company?.id;
  // Fail closed: an empty or malformed id must never turn into "no filter".
  if (typeof companyId !== "string" || !UUID.test(companyId)) {
    throw new Error("flightsOf: a company id is required to read or write flights");
  }
  const stamp = (row: Row): Row => ({ ...row, company_id: companyId });

  return {
    select: (
      columns = "*",
      options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
    ) => table().select(columns, options).eq("company_id", companyId),

    insert: (rows: Row | Row[]) =>
      table().insert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows)),

    update: (patch: Row) => {
      const { company_id: _never, ...rest } = patch;
      void _never;
      return table().update(rest).eq("company_id", companyId);
    },
  };
}

/** Constant scope of every event feature. */
export const megaEventsFlights = () => flightsOf({ id: MEGA_EVENTS_COMPANY_ID });

type ProductTypes = Pick<Company, "productTypes">;

/** Event links, allocations and the price push to events exist only here. */
export const sellsEvents = (company: ProductTypes): boolean =>
  company.productTypes.includes("events");

/** The group-block lifecycle and the tours operations columns exist only here. */
export const sellsTours = (company: ProductTypes): boolean =>
  company.productTypes.includes("tours");
