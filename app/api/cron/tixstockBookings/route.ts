import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { realSweepDeps } from "@/lib/services/tixstock-booking-store";
import { SWEEP_BATCH, sweepTixstockBookings } from "@/lib/services/tixstock-booking-sweep";

/**
 * The TixStock bookings sweep, every 10 minutes (vercel.json): closes holds nobody finished, approves an order
 * left in Sale on Hold, raises the two alerts, and once a day reads back an order that still has no ticket. It
 * never adds an order. The rules and their clocks are in lib/services/tixstock-booking-sweep.ts
 * (selftest scripts/tixstock-booking-sweep-selftest.ts); this file only guards, runs and answers.
 *
 * `?dry_run=1` answers what a real run would do: no TixStock call, no write, no mail.
 * With no booking rows (every real event today) a run is two empty reads.
 */
export const maxDuration = 60;

/**
 * No new row starts after this. One row is at most one TixStock call (15 s timeout) and one mail, so a run
 * answers inside maxDuration.
 */
const TIME_BUDGET_MS = 35_000;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  const startedAt = Date.now();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const result = await sweepTixstockBookings(new Date(startedAt), realSweepDeps(), {
      dryRun,
      limit: SWEEP_BATCH,
      outOfTime: () => Date.now() - startedAt > TIME_BUDGET_MS,
    });
    return NextResponse.json({ success: true, dryRun, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("tixstockBookings sweep failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
