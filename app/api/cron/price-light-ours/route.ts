import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { OUR_OFFER_BUDGET_MS, runOurOfferPass } from "@/lib/services/our-offer-detail";
import { runAlternativesPass } from "@/lib/services/price-alternatives";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";

/**
 * Nightly (vercel.json, 02:40 UTC - after base-price-sync has finished its own Amadeus searches):
 * describe OUR package contents - airline, flight times, bag, hotel, board - for the events whose
 * description is missing or older than a week, and store them under `light_detail.ours` for the
 * /price-light side-by-side comparison. Reads the pricing rule, never writes a price.
 *
 * `?dry_run=1` searches but writes nothing (the searches are the thing being tested, so a dry run
 * still calls Amadeus). `?limit=N` caps the events visited - for a quick manual check.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry_run") === "1";
  const limitParam = Number(params.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
  const started = Date.now();
  try {
    const summary = await runOurOfferPass({ dryRun, limit });
    // Second half of the same run (2026-09-18): what is left of the budget quotes the RED events'
    // alternatives - other travel days, other ticket suppliers - for the price advisor. After the
    // descriptions on purpose: once the weekly rotation has caught up it takes seconds, and the
    // advisor's facts are read by tomorrow's tasks, not tonight's.
    const alternatives = await runAlternativesPass({ dryRun, limit, budgetMs: OUR_OFFER_BUDGET_MS - (Date.now() - started) });
    if (!dryRun && summary.described + alternatives.quoted > 0) invalidatePriceLight("rows"); // `light_detail.ours` feeds the rows' "ours" lines
    console.log(
      `[price-light-ours] candidates=${summary.candidates} described=${summary.described} fresh=${summary.fresh} ` +
      `withErrors=${summary.withErrors} failedWrites=${summary.failedWrites} remaining=${summary.remaining} | ` +
      `alternatives candidates=${alternatives.candidates} quoted=${alternatives.quoted} withErrors=${alternatives.withErrors} ` +
      `remaining=${alternatives.remaining}${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json({ ...summary, alternatives });
  } catch (error) {
    console.error("[price-light-ours] fatal", error);
    return NextResponse.json({ error: "our-offer pass failed" }, { status: 500 });
  }
}
