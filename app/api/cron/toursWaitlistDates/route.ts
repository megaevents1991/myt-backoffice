import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runWaitlistDates } from "@/lib/services/tours-waitlist-dates";

// Every hour at :35 (vercel.json): a date that opened on a tour a card waits for moves the card to "נפתח תאריך", with a
// follow-up on the next working day, and sends the customer one WhatsApp when the company's number can. Nothing moves
// at night or on Shabbat (the rule is in lib/tours/waitlist-dates.ts, so the schedule stays one line).
// ?dry_run=1 = the full report (case numbers and date codes), no write and no send.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runWaitlistDates({ dryRun });
    for (const c of summary.companies) {
      console.log(
        `[toursWaitlistDates] ${c.slug} open=${c.open} stamped=${c.stamped} cleared=${c.cleared} waiting=${c.waiting} due=${c.due} moved=${c.moved} sent=${c.sent} remaining=${c.remaining}${c.outsideHours ? " (outside hours)" : ""}${c.problem ? ` problem=${c.problem}` : ""}${c.errors.length ? ` errors=${c.errors.join("; ")}` : ""}${dryRun ? " (dry-run)" : ""}`,
      );
    }
    return NextResponse.json(summary, { status: summary.errors.length ? 500 : 200 });
  } catch (error) {
    console.error("[toursWaitlistDates] fatal", error instanceof Error ? error.message : JSON.stringify(error));
    return NextResponse.json({ error: "waiting-list check failed" }, { status: 500 });
  }
}
