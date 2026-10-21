import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

/**
 * Audit-log retention: audit_log rows are kept for 30 days, then hard-deleted
 * nightly. This is the ONE table where hard delete is the policy (soft-delete
 * rule applies to events, not to the audit trail). Uses the
 * audit_log_created_at_idx index, so the delete is a cheap range scan.
 * Schedule lives in vercel.json (daily 04:30 UTC).
 */
export const maxDuration = 60;

const RETENTION_DAYS = 30;
/** `uploader.*` rows (the tour uploader's memory, lookback 180 days) go after this many days - a pass of their own. */
const UPLOADER_RETENTION_DAYS = 180;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // `price_light.*` rows are exempt: those are the staff decisions the price-light agent reads
    // back as evidence (lib/agents/memory.ts looks 120 days back), so dropping them at 30 days
    // silently capped the agent's memory at a month. They expire on the price-light retention
    // pass instead - /api/cron/price-light-retention, 180 days.
    // `agent.*` rows (AI Factory, 2026-09-17) are exempt for the same reason: `agent.feedback` is
    // what an agent's own maturity score and lessons are computed from (lib/agents/maturity.ts,
    // lib/agents/price-light.agent.ts) - losing it at 30 days would cap every agent's memory the
    // same way price_light.* almost did. No separate retention pass reclaims these yet; they are
    // low-volume (one row per manual approve/reject on an AI Factory log) so that is fine for now.
    // `uploader.*` rows (tour uploader agent, 2026-10-21) are exempt too: approvals, edits and
    // rejections are what that agent learns from over 180 days (lib/agents/memory.ts) - the 30-day
    // purge would cut its memory to a month. Low-volume (one row per staff decision); the second pass
    // below reclaims them at UPLOADER_RETENTION_DAYS (180), the end of that lookback.
    // `audit_log` predates the generated DB types - one boundary cast (repo pattern).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase as any)
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("created_at", cutoff)
      .not("action", "like", "price_light.%")
      .not("action", "like", "agent.%")
      .not("action", "like", "uploader.%");

    if (error) {
      console.error("purgeAuditLog delete failed:", JSON.stringify(error));
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // The tour uploader's rows, exempt above, expire at the end of the agent's own lookback.
    const uploaderCutoff = new Date(Date.now() - UPLOADER_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploader = await (supabase as any)
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("created_at", uploaderCutoff)
      .like("action", "uploader.%");
    if (uploader.error) {
      console.error("purgeAuditLog uploader.* delete failed:", JSON.stringify(uploader.error));
      return NextResponse.json({ success: false, error: uploader.error.message, deleted: count ?? 0 }, { status: 500 });
    }

    console.log(`purgeAuditLog: deleted ${count ?? 0} rows older than ${cutoff}, ${uploader.count ?? 0} uploader.* rows older than ${uploaderCutoff}`);
    return NextResponse.json({ success: true, deleted: count ?? 0, cutoff, uploaderDeleted: uploader.count ?? 0, uploaderCutoff });
  } catch (e) {
    console.error("purgeAuditLog failed:", e);
    return NextResponse.json(
      { success: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}
