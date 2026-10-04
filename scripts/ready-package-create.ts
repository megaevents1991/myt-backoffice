/**
 * Compose a ready package ("חבילה מוכנה") for an event WITHOUT the portal wizard, by a plain
 * rule: the cheapest ticket on sale (or --category), the cheapest direct flight with a checked
 * bag, the cheapest hotel of --stars (default 4) or more with a meal. For a test package, or a
 * first draft staff then replace from the event editor.
 *
 *   npx tsx --env-file=.env.local scripts/ready-package-create.ts <eventId> [--apply]
 *       [--category "Category 1"] [--stars 4] [--travelers 2] [--max 4]
 *
 * Without --apply it only SEARCHES and prints what it would save. With --apply it writes the
 * house row, points the event at it in `preview` (customers never see a preview: a click on
 * the site card still opens the regular flow; only the printed link opens the package) and
 * prices every party size up to --max.
 */
import { logAudit } from "@/lib/audit";
import { flightLabel, hotelLabel, type FlightLike, type HotelLike } from "@/lib/ready-package";
import {
  composeAuto,
  createHousePackage,
  loadReadyEvent,
  refreshHousePackage,
  toReadyView,
} from "@/lib/services/ready-package";
import { supabaseTyped } from "@/lib/supabase-server";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<number> {
  const eventId = Number(args[0]);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    console.error("usage: ready-package-create.ts <eventId> [--apply] [--category X] [--stars 4] [--travelers 2] [--max 4]");
    return 1;
  }
  const apply = args.includes("--apply");
  const travelers = Number(flag("travelers") ?? 2);
  const max = Number(flag("max") ?? 4);

  const composed = await composeAuto({
    eventId,
    travelers,
    category: flag("category"),
    minStars: flag("stars") ? Number(flag("stars")) : undefined,
  });
  if (!composed.ok) {
    console.error(`cannot compose: ${composed.error}`);
    return 1;
  }
  const { composition, notes } = composed;
  const info = composition.event_order_info as { name?: string; category?: string; price_per_ticket?: number; price_per_person?: number };
  console.log(`event ${eventId}: ${info.name}`);
  console.log(`  ticket: ${info.category} ($${info.price_per_ticket})`);
  console.log(`  flight: ${flightLabel(composition.flight_order_info as FlightLike | null, composition.flight_skipped)}`);
  console.log(`  hotel:  ${hotelLabel(composition.hotel_order_info as HotelLike | null, composition.hotel_skipped)}`);
  console.log(`  price:  $${info.price_per_person} per person, ${travelers} travellers`);
  for (const note of notes) console.log(`  note:   ${note}`);

  if (!apply) {
    console.log("dry run - nothing written. Add --apply to save it as a preview package.");
    return 0;
  }

  const created = await createHousePackage({ eventId, composition, createdBy: null });
  if (!created.ok) {
    console.error(`not saved: ${created.error}`);
    return 1;
  }
  if (Number.isInteger(max) && max >= travelers) {
    const { error } = await supabaseTyped.from("prepared_packages").update({ max_travelers: max }).eq("id", created.row.id);
    if (error) console.error("max travellers not saved:", JSON.stringify(error));
    else created.row.max_travelers = max;
  }
  const summary = await refreshHousePackage(created.row);
  await logAudit({
    action: "ready_package.adopted",
    entityType: "event",
    entityId: eventId,
    metadata: { package_id: created.row.id, source: "scripts/ready-package-create.ts" },
    actor: { id: null, email: "script", role: null },
  });

  const event = await loadReadyEvent(eventId);
  const view = event ? toReadyView({ ...created.row, refresh_status: summary.status }, event) : null;
  console.log(`saved: package ${created.row.id}, status ${summary.status}, sizes priced: ${summary.sizes.join(", ")}`);
  if (summary.note) console.log(`  ${summary.note}`);
  if (view) console.log(`  mode: ${view.mode}\n  link: ${view.previewUrl}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
