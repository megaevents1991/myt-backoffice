"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { approveFeedPriceHold } from "@/lib/services/feed-price-guard";
import { pushEventToFeedAction } from "@/lib/actions/meta-feed-actions";

export type ApproveFeedPriceResult =
  | { ok: true; cardUsd: number; inFeed: boolean; whyNot: string[] }
  | { ok: false; kind: "forbidden" | "invalid" | "not_ready" | "not_found" | "not_held" | "no_price" | "failed"; error: string };

/**
 * "המחיר נכון - החזר לפיד" in the event editor: an admin approves the price the feed guard held
 * (lib/feed/price-guard.ts), and the event goes straight back - its creative drawn, the feed
 * republished. The approval covers that price while it moves less than 10%.
 */
export async function approveFeedPrice(eventId: number): Promise<ApproveFeedPriceResult> {
  let session: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    session = await requireAdmin();
  } catch {
    // A thrown action error is masked in production - answer it.
    return { ok: false, kind: "forbidden", error: "רק מנהל יכול לאשר מחיר חריג" };
  }
  if (!Number.isInteger(eventId) || eventId <= 0) return { ok: false, kind: "invalid", error: "Invalid event id" };
  try {
    const approved = await approveFeedPriceHold(eventId, session.email ?? session.sub);
    if (!approved.ok) return approved;
    const pushed = await pushEventToFeedAction(eventId);
    if (!pushed.ok) {
      return { ok: false, kind: "failed", error: `המחיר אושר, אבל ההעלאה לפיד נכשלה: ${pushed.error}` };
    }
    return { ok: true, cardUsd: approved.cardUsd, inFeed: pushed.inFeed, whyNot: pushed.whyNot };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[feed-price-guard] approve failed:", error);
    return { ok: false, kind: "failed", error };
  }
}
