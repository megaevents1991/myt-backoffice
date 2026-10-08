import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runMarketingSync, SYNC_STEPS, type SyncStep } from "@/lib/services/marketing-sync";
import { appOrigin, sendMail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";

/**
 * Marketing dashboard sync - Meta + Google spend and entities, Google click_view,
 * Instagram media + insights, ticket-cost fill, alerts, retention. Every six hours: 01:20,
 * 07:20, 13:20 and 19:20 UTC (vercel.json `20 1,7,13,19 * * *`). Manual:
 * `?key=<NEXT_SECRET_CRON_SECRET_KEY>`; `&dry_run=1` reads everything and
 * writes / mails nothing; `&only=meta|google|instagram|cogs|alerts|retention` runs one step
 * (anything else answers 400); `&backfill_days=90` widens the spend / click window once.
 * Spec: docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md section 4.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry_run") === "1";
  const onlyRaw = params.get("only");
  // A typo must not silently run all six steps (writes and mails included).
  if (onlyRaw !== null && !SYNC_STEPS.includes(onlyRaw as SyncStep)) {
    return NextResponse.json({ ok: false, error: "unknown step" }, { status: 400 });
  }
  const only = (onlyRaw ?? undefined) as SyncStep | undefined;
  const backfill = Number(params.get("backfill_days"));
  try {
    const summary = await runMarketingSync({ dryRun, only, backfillDays: Number.isFinite(backfill) && backfill > 0 ? Math.min(backfill, 180) : undefined, budgetMs: 270_000 });
    console.log(`[marketingSync]${dryRun ? " (dry-run)" : ""}`, JSON.stringify(summary));
    const failed = summary.steps.filter((s) => !s.ok);
    const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
    if (!dryRun && failed.length > 0 && to) {
      try {
        // A step's note can carry an API's own error text - escaped like the alert mail's values.
        await sendMail({ to, subject: `Marketing sync: ${failed.length} step(s) failed`, html: [`<p><a href="${escapeHtml(appOrigin())}/marketing">Open /marketing</a></p>`, ...failed.map((s) => `<p><b>${escapeHtml(s.step)}</b>: ${escapeHtml(s.note)}</p>`)].join("") });
      } catch (e) { console.error("[marketingSync] mail failed", e); }
    }
    return NextResponse.json({ ok: failed.length === 0, ...summary }); // summary carries dryRun
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[marketingSync] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
