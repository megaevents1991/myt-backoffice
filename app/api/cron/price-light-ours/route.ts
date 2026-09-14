import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runOurOfferPass } from "@/lib/services/our-offer-detail";

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
  try {
    const summary = await runOurOfferPass({ dryRun, limit });
    console.log(
      `[price-light-ours] candidates=${summary.candidates} described=${summary.described} fresh=${summary.fresh} ` +
      `withErrors=${summary.withErrors} failedWrites=${summary.failedWrites} remaining=${summary.remaining}` +
      `${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-ours] fatal", error);
    return NextResponse.json({ error: "our-offer pass failed" }, { status: 500 });
  }
}
