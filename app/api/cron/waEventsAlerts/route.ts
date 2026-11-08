import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runEventsAlerts } from "@/lib/services/whatsapp-events-alerts";

// Every 15 minutes in Israel's working hours (vercel.json; the rule itself checks Sunday-Thursday 09:00-17:00):
// Mega Events WhatsApp chats waiting 60+ working minutes -> ONE digest of the newly unanswered ones.
// ?dry_run=1 = the report, nothing mailed or stamped.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runEventsAlerts({ dryRun });
    console.log(`[waEventsAlerts] unanswered=${summary.unanswered} mailed=${summary.mailed}${summary.skipped ? ` skipped=${summary.skipped}` : ""}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[waEventsAlerts] fatal", error instanceof Error ? error.message : JSON.stringify(error));
    return NextResponse.json({ error: "whatsapp alerts failed" }, { status: 500 });
  }
}
