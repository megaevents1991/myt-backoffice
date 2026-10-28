"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { cachedSalesBreakdown } from "@/lib/services/marketing-sales";
import { cachedInfluencerStats } from "@/lib/services/marketing-influencers";
import { readMarketingSettings } from "@/lib/services/marketing-settings";
import { resolveWindow } from "@/lib/marketing/range";
import { parseSource } from "@/lib/marketing/order-source";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import type { MarketingQuery } from "@/lib/actions/marketing-actions";
import type { MarketingSettings } from "@/types/marketing.types";

/**
 * The Sales and Influencers tabs, ONE action each (Next runs a tab's actions one at a time). Spec 2026-10-28.
 * Both read our own orders, so brand does not apply (the orders are the Mega Events site's - the Executive funnel's
 * rule); the Sales tab follows the bar's source filter, the Influencers tab is partners by definition.
 */

const currencyOf = (q: MarketingQuery): MarketingCurrency => (q.cur === "usd" ? "usd" : "ils");

export async function getSales(q: MarketingQuery) {
  await requireAdmin();
  const { since, until } = resolveWindow(q);
  return cachedSalesBreakdown(since, until, parseSource(q.src), currencyOf(q));
}

/** The thresholds ride along so the tab can say what its "No sales" / "Selling" badges mean. */
export async function getInfluencers(q: MarketingQuery) {
  await requireAdmin();
  const { since, until } = resolveWindow(q);
  const settings = await readMarketingSettings();
  const thresholds: Pick<MarketingSettings, "influencer_min_visitors" | "influencer_hot_orders"> = {
    influencer_min_visitors: settings.influencer_min_visitors,
    influencer_hot_orders: settings.influencer_hot_orders,
  };
  return { ...(await cachedInfluencerStats(since, until, currencyOf(q), thresholds)), thresholds };
}
