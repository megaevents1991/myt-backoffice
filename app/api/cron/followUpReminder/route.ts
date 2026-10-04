import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runFollowUpReminder } from "@/lib/services/follow-up-reminder";

// Sunday-Thursday 05:15 UTC (vercel.json) - the office's working days, morning in Israel.
// Reservations in Follow-up whose customer is waiting today -> one mail to the reminder list.
// ?dry_run=1 = the full report, nothing mailed.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runFollowUpReminder({ dryRun });
    console.log(
      `[followUpReminder] pile=${summary.counts.total} waiting=${summary.waiting.length} mails=${summary.mails.length} errors=${summary.errors.length}${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[followUpReminder] fatal", error instanceof Error ? error.message : JSON.stringify(error));
    return NextResponse.json({ error: "follow-up reminder failed" }, { status: 500 });
  }
}
