/**
 * The two hidden test events of TixStock's health check, on PRODUCTION (plan Task 16):
 *   A  "TEST · Juventus FC vs Como (TixStock sandbox)"           tixstock_booking = sandbox_site
 *   B  "TEST · Juventus FC vs Como (TixStock sandbox · office)"  tixstock_booking = sandbox_office
 * Both are is_test, ticket-only, not hidden (confirm-order refuses a hidden event) and priced from TixStock's
 * SANDBOX feed - one ticket row per category at the price the site's sandbox card will show.
 *
 *   npx tsx --env-file=.env.local scripts/tixstock-sandbox-test-events.ts            dry run: prints, writes nothing
 *   npx tsx --env-file=.env.local scripts/tixstock-sandbox-test-events.ts --apply    writes (Dor's go, push lock)
 *
 * Safe to run again: a row is found by its name. An existing row gets ONLY its tickets refreshed from the feed
 * (ids, zones and colours kept) - run it after the Seller Portal listings change, so the prices follow. It never
 * touches a row that is not a test event with the same booking mode.
 * The rows and the ticket rule are in lib/services/tixstock-sandbox-events.ts (scripts/tixstock-sandbox-events-selftest.ts).
 * Not set here: the venue map - attach it in the event editor ("Suppliers & zones").
 * After --apply: scripts/tixstock-sync-selection-check.ts and scripts/portal-test-events-check.ts.
 */
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase-server";
import { tixstockClientFor } from "@/lib/services/tixstock-booking-env";
import {
  SANDBOX_EVENT_NAMES,
  SANDBOX_TICKET_ONLY_MARKUP_USD,
  SANDBOX_TIXSTOCK_EVENT_ID,
  listingFacts,
  sandboxEventRow,
  sandboxTickets,
  type SandboxTicket,
} from "@/lib/services/tixstock-sandbox-events";
import type { TixstockBookingMode } from "@/lib/tixstock-booking/rules";

const APPLY = process.argv.includes("--apply");
const MODES: TixstockBookingMode[] = ["sandbox_site", "sandbox_office"];

type ExistingRow = { id: number; is_test: boolean; tixstock_booking: string | null; tickets_and_rates: SandboxTicket[] | null };

// The shared client carries no table types, so a write through it is typed `never` (lib/supabase-server.ts). The
// two writes of this script go through this narrow shape instead of an `any`.
type WriteError = { message: string } | null;
type UpdateFilter = {
  eq(column: string, value: unknown): UpdateFilter;
  select(columns: string): PromiseLike<{ data: { id: number }[] | null; error: WriteError }>;
};
type EventsWriter = {
  from(table: "events"): {
    insert(row: Record<string, unknown>): { select(columns: string): { single(): PromiseLike<{ data: { id: number } | null; error: WriteError }> } };
    update(patch: Record<string, unknown>): UpdateFilter;
  };
};
const writer = supabase as unknown as EventsWriter;

async function main(): Promise<number> {
  console.log(APPLY ? "APPLY - this run WRITES to production" : "DRY RUN - nothing is written (add --apply to write)");

  const resolved = tixstockClientFor("sandbox");
  if (!resolved.ok) {
    console.error("The sandbox is not configured: NEXT_SECRET_TIXSTOCK_SANDBOX_URL / NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN in .env.local.");
    return 1;
  }

  const country = await resolved.client.eventVenueCountry(SANDBOX_TIXSTOCK_EVENT_ID);
  console.log(`\nTixStock sandbox event ${SANDBOX_TIXSTOCK_EVENT_ID}: venue country ${country.ok ? (country.data ?? "not said") : `unread (${country.kind})`}`);
  if (country.ok && country.data !== "IT") console.log("  NOTE: not IT - the Serie A attendee item of the health check needs an Italian venue.");

  const feed = await resolved.client.listings(SANDBOX_TIXSTOCK_EVENT_ID);
  if (!feed.ok) {
    console.error(`The sandbox feed did not answer: ${feed.kind}${feed.kind === "refused" ? ` ${feed.status} ${feed.message}` : ` ${feed.detail}`}`);
    return 1;
  }
  console.log(`${feed.data.length} listing(s) in the sandbox feed:`);
  for (const listing of feed.data) {
    const f = listingFacts(listing);
    console.log(
      `  ${f.id}  ${f.category} / ${f.section}${f.row ? ` / row ${f.row}` : ""}  type=${f.type}  split="${f.splitType}"  delivery=${f.deliveryType}` +
        `  lead_booker=${f.leadBooker}  instant=${f.instantDownload}  qty=${f.quantity} (display ${f.displayQuantity})  ${f.amount ?? "no price"} ${f.currency}`,
    );
  }

  const column = await supabase.from("events").select("id, tixstock_booking").limit(1);
  if (column.error) {
    console.error(`events.tixstock_booking is not readable (${column.error.message}) - migration 20261110100000 is not live. Nothing written.`);
    return 1;
  }

  for (const mode of MODES) {
    const name = SANDBOX_EVENT_NAMES[mode];
    console.log(`\n=== ${mode}: "${name}"`);
    const found = await supabase.from("events").select("id, is_test, tixstock_booking, tickets_and_rates").eq("name", name).is("is_deleted", null).limit(2);
    if (found.error) {
      console.error(`events read failed: ${found.error.message}`);
      return 1;
    }
    const rows = (found.data ?? []) as unknown as ExistingRow[];
    if (rows.length > 1) {
      console.error(`${rows.length} events carry this name (${rows.map((r) => r.id).join(", ")}) - settle that by hand. Nothing written.`);
      return 1;
    }
    const existing = rows[0];
    if (existing && (existing.is_test !== true || existing.tixstock_booking !== mode)) {
      console.error(`event ${existing.id} has this name but is not a ${mode} test event (is_test=${existing.is_test}, tixstock_booking=${existing.tixstock_booking}). Not touched.`);
      return 1;
    }

    const before = existing?.tickets_and_rates ?? [];
    const tickets = sandboxTickets(feed.data, SANDBOX_TIXSTOCK_EVENT_ID, before, randomUUID);
    const live = tickets.filter((t) => t.eid === SANDBOX_TIXSTOCK_EVENT_ID && t.available !== false);
    if (live.length === 0) {
      console.error("No listing in the sandbox can get a card (on sale, USD, no lead booker) - create the Seller Portal listings first. Nothing written.");
      return 1;
    }
    const cheapest = Math.min(...live.map((t) => t.price));
    console.log(`tickets: ${tickets.length} row(s); the cheapest card $${cheapest}, the customer pays $${cheapest + SANDBOX_TICKET_ONLY_MARKUP_USD} a ticket`);
    for (const t of tickets) {
      const old = before.find((b) => b.id === t.id);
      const note = !old ? "new" : old.price === t.price ? "unchanged" : `was $${old.price}`;
      console.log(`  ${t.category}: $${t.price}  (${note})`);
    }

    if (existing) {
      console.log(`exists as event ${existing.id}: only its tickets are refreshed`);
      if (!APPLY) continue;
      const updated = await writer.from("events").update({ tickets_and_rates: tickets }).eq("id", existing.id).eq("is_test", true).eq("tixstock_booking", mode).select("id");
      if (updated.error || (updated.data ?? []).length !== 1) {
        console.error(`update of event ${existing.id} failed: ${updated.error?.message ?? "no row matched"}`);
        return 1;
      }
      console.log(`event ${existing.id}: tickets written`);
      continue;
    }

    const row = sandboxEventRow(mode, tickets);
    console.log("the row:");
    console.log(JSON.stringify(row, null, 2));
    if (!APPLY) continue;
    const inserted = await writer.from("events").insert(row).select("id").single();
    if (inserted.error || !inserted.data) {
      console.error(`insert failed: ${inserted.error?.message ?? "no row came back"}`);
      return 1;
    }
    console.log(`created event ${inserted.data.id}`);
  }

  console.log(
    APPLY
      ? "\nWritten. Now: attach the venue map in the editor of each event, and run scripts/tixstock-sync-selection-check.ts + scripts/portal-test-events-check.ts."
      : "\nDRY RUN - nothing was written.",
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
