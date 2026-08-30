import { NextRequest, NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import {
  isSyncStepId,
  type SyncStepId,
  type SyncStepResult,
} from "@/lib/sync-steps";
import { syncEvents } from "@/lib/services/sports-events-sync";
import { syncLiveEvents } from "@/lib/services/live-events-sync";
import { syncTixStockEvents } from "@/lib/services/tixstock-sync";
import { syncTixStockPrices } from "@/lib/services/tixstock-price-sync";
import { ticketPriceSyncService } from "@/lib/services/ticket-price-sync";
import { runCampaignCreatives } from "@/lib/creative/auto";
import { publishMetaFeeds } from "@/lib/feed/publish-meta-feed";

/**
 * Staff-triggered version of the nightly crons - one step per request, driven
 * by the "סנכרון מלא" button on /meta-feed (see lib/sync-steps.ts for the
 * pipeline). Admin-triggered, so it takes `guardAdminRoute()`, NOT the cron
 * guard: no secret is involved, the caller's session decides.
 *
 * Long jobs (TixStock, creatives) are why this route carries the same 800s
 * duration as the crons; the creatives step additionally reports `remaining`
 * so the client can call it again until the backlog is empty.
 */
export const maxDuration = 800;

// Leave headroom under maxDuration so the run returns its summary instead of
// being killed mid-render (the client just calls again for what's left).
const CREATIVE_TIME_BUDGET_MS = 700_000;

async function runStep(step: SyncStepId): Promise<SyncStepResult> {
  switch (step) {
    case "sports-events": {
      const r = await syncEvents();
      if (r.status === "error") throw new Error(r.error ?? "sync failed");
      return { step, summary: `${r.count} אירועי ספורט עודכנו` };
    }
    case "live-events": {
      const r = await syncLiveEvents();
      if (r.status === "error") throw new Error(r.error ?? "sync failed");
      return { step, summary: `${r.count} אירועי LIVE עודכנו` };
    }
    case "tixstock-events": {
      const r = await syncTixStockEvents();
      if (r.status === "error") throw new Error(r.error ?? "sync failed");
      return {
        step,
        summary: `${r.count} אירועי TixStock ב־${r.durationSeconds} שנ׳`,
      };
    }
    case "tixstock-prices": {
      // Same budget pattern as creatives: stop under the 800s ceiling, report
      // what's left, and the client calls again until remaining hits 0.
      const r = await syncTixStockPrices({
        timeBudgetMs: 700_000,
        concurrency: 4,
      });
      const errors = r.errors.length ? `, ${r.errors.length} שגיאות` : "";
      return {
        step,
        summary: `${r.ticketsUpdated} כרטיסים עודכנו ב־${r.eventsProcessed} אירועים${errors}`,
        remaining: r.remaining,
      };
    }
    case "ticket-prices": {
      const r = await ticketPriceSyncService.syncAllTicketPrices();
      const errors = r.errors.length ? `, ${r.errors.length} שגיאות` : "";
      return {
        step,
        summary: `${r.successfulUpdates}/${r.totalTickets} מחירי כרטיסים עודכנו${errors}`,
      };
    }
    case "campaign-creatives": {
      const r = await runCampaignCreatives({
        timeBudgetMs: CREATIVE_TIME_BUDGET_MS,
      });
      const errors = r.errors.length ? `, ${r.errors.length} שגיאות` : "";
      const skipped = r.skipped.length ? `, ${r.skipped.length} דולגו` : "";
      return {
        step,
        summary: `${r.generated.length} קריאטיבים נוצרו, ${r.current} כבר עדכניים${skipped}${errors}`,
        remaining: r.remaining,
      };
    }
    case "publish-feed": {
      const r = await publishMetaFeeds();
      return {
        step,
        summary: `${r.activityRows} אירועים פורסמו לקובץ שמטא קוראת`,
      };
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ step: string }> },
) {
  const denied = await guardAdminRoute();
  if (denied) return denied;

  const { step } = await params;
  if (!isSyncStepId(step)) {
    return NextResponse.json(
      { error: `Unknown sync step "${step}"` },
      { status: 400 },
    );
  }

  try {
    const result = await runStep(step);
    await logAudit({
      action: "sync",
      entityType: "admin_sync",
      entityId: step,
      metadata: { summary: result.summary, remaining: result.remaining ?? 0 },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[admin-sync] ${step} failed:`, message);
    return NextResponse.json(
      { ok: false, step, error: message },
      { status: 500 },
    );
  }
}
