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

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { count, error } = await (supabase as any)
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);

    if (error) {
      console.error("purgeAuditLog delete failed:", JSON.stringify(error));
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(`purgeAuditLog: deleted ${count ?? 0} rows older than ${cutoff}`);
    return NextResponse.json({ success: true, deleted: count ?? 0, cutoff });
  } catch (e) {
    console.error("purgeAuditLog failed:", e);
    return NextResponse.json(
      { success: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}
