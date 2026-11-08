import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runEventsSchedule } from "@/lib/services/whatsapp-events-schedule";

// Hourly at :05 (vercel.json): Mega Events' WhatsApp messages by date whose slot falls in this Israel hour - the flight
// reminder (09:00, 3 days before), "the event is today" (10:00), "how was it" (11:00, only with EVENTS_WA_AFTER_TRIP=on).
// They join wa_outbox; the 2-minute drain sends them. ?dry_run=1 = what it would queue, nothing written.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runEventsSchedule({ dryRun });
    console.log(`[waEventsSchedule] enqueued=${summary.enqueued.length} skipped=${summary.skipped.length}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[waEventsSchedule] fatal", error instanceof Error ? error.message : JSON.stringify(error));
    return NextResponse.json({ error: "whatsapp schedule failed" }, { status: 500 });
  }
}
