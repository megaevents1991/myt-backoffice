import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runOverdueAlerts } from "@/lib/services/task-overdue-alerts";

// Sunday-Thursday 06:30 UTC (vercel.json) - the office's working days, morning in Israel.
// Tasks past their deadline with no answer from the assignee -> one mail per opener.
// ?dry_run=1 = the full report, nothing mailed or written.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runOverdueAlerts({ dryRun });
    console.log(
      `[taskOverdueAlerts] overdue=${summary.overdue} late=${summary.late} raised=${summary.raised} mails=${summary.mails.length} errors=${summary.errors.length}${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[taskOverdueAlerts] fatal", error instanceof Error ? error.message : JSON.stringify(error));
    return NextResponse.json({ error: "overdue alerts failed" }, { status: 500 });
  }
}
