import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runWeeklyTaskGen } from "@/lib/services/weekly-task-gen";

// Daily 06:00 UTC (vercel.json); each rule runs only on its own UTC weekday. ?dry_run=1 = zero writes.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runWeeklyTaskGen({ dryRun, budgetMs: 270_000 });
    console.log(
      `[weeklyTaskGen] ran=${summary.ran} created=${summary.created} existed=${summary.existed} closed=${summary.closed} errors=${summary.errors.length}${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[weeklyTaskGen] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "weekly task gen failed" }, { status: 500 });
  }
}
