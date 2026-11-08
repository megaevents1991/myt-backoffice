import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { drainOutbox } from "@/lib/services/whatsapp-events-outbox";

// Every 2 minutes (vercel.json): Mega Events' queued WhatsApp order updates whose time came (spec 2026-11-08 section 9).
// The staff actions drain their own order at once; this sends what myt-main's checkout and the schedule queued.
// ?dry_run=1 = the decisions, nothing sent or written.
export const maxDuration = 60;
const BUDGET_MS = 45_000;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await drainOutbox({ budgetMs: BUDGET_MS, dryRun });
    console.log(`[waEventsOutbox] sent=${summary.sent} skipped=${summary.skipped} failed=${summary.failed} waiting=${summary.waiting}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[waEventsOutbox] fatal", error instanceof Error ? error.message : JSON.stringify(error));
    return NextResponse.json({ error: "whatsapp outbox failed" }, { status: 500 });
  }
}
