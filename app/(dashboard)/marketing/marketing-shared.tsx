"use client";

import { useEffect, useState } from "react";

import { useUrlState } from "@/hooks/use-view-state";
import { getMarketingPnl } from "@/lib/actions/marketing-actions";
import { MARKETING_RANGES, type MarketingRange } from "@/lib/services/marketing-pnl";
import type { AdBrand, AdPlatform } from "@/types/marketing.types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * What the Executive and Media tabs share: the two filters (kept in the URL as `?range=` and
 * `?brand=`, so a refresh or a pasted link lands on the same view), the one load of the P&L,
 * the money format and the POAS colours. Only one of the two tabs is mounted at a time, so
 * they never both load.
 */

export const BRAND_FILTERS = ["mega_events", "other", "all"] as const;
export type BrandFilter = (typeof BRAND_FILTERS)[number];

export const RANGE_LABEL: Record<MarketingRange, string> = {
  "7d": "7 ימים",
  "30d": "30 ימים",
  "90d": "90 ימים",
  month: "החודש",
};

export const BRAND_FILTER_LABEL: Record<BrandFilter, string> = {
  mega_events: "Mega Events",
  other: "אחר",
  all: "הכל",
};

export const BRAND_LABEL: Record<AdBrand, string> = { mega_events: "Mega Events", other: "אחר" };
export const PLATFORM_LABEL: Record<AdPlatform, string> = { meta: "מטא", google: "גוגל" };

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
export const usd = (n: number): string => usdFormat.format(n);

/** POAS colour: below 0 red (the campaign loses money), 0..1 amber, above 1 green. No number = neutral. */
export function poasTone(poas: number | null): string {
  if (poas === null) return "";
  if (poas < 0) return "text-destructive";
  if (poas <= 1) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export type PnlResult = Awaited<ReturnType<typeof getMarketingPnl>>;

/** Next replaces what a server action threw with its own text in a production build ("An error occurred in the
 *  Server Components render. The specific message is omitted ..."), with a digest the server log carries. */
const MASKED_PROD_ERROR = /An error occurred in the Server Components render/i;

export function errorText(e: unknown): string {
  if (!(e instanceof Error) || !e.message) return "שגיאה בטעינה";
  const hasDigest = "digest" in e || /digest/i.test(e.message);
  if (MASKED_PROD_ERROR.test(e.message) || (/Server Action/i.test(e.message) && hasDigest)) {
    return "הטעינה נכשלה - פרטים ביומני השרת";
  }
  return e.message;
}

export function useMarketingFilters() {
  const [range, setRange] = useUrlState<MarketingRange>("range", "30d", MARKETING_RANGES);
  const [brand, setBrand] = useUrlState<BrandFilter>("brand", "mega_events", BRAND_FILTERS);
  return { range, setRange, brand, setBrand };
}

/** The filters plus the P&L they select. A load that fails lands in `error` (shown inline) - the
 *  actions THROW on a database error, and an empty state would read as "nothing to see". */
export function useMarketingPnl() {
  const filters = useMarketingFilters();
  const { range, brand } = filters;
  const [data, setData] = useState<PnlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const pnl = await getMarketingPnl(range, brand);
        if (!cancelled) setData(pnl);
      } catch (e) {
        console.error("Error loading the marketing P&L:", e);
        if (!cancelled) {
          setData(null);
          setError(errorText(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [range, brand]);

  return { ...filters, data, error, loading };
}

export function MarketingFilters({
  range,
  setRange,
  brand,
  setBrand,
}: ReturnType<typeof useMarketingFilters>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={range} onValueChange={(v) => setRange(v as MarketingRange)}>
        <SelectTrigger className="h-9 w-[130px]" aria-label="טווח">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MARKETING_RANGES.map((r) => (
            <SelectItem key={r} value={r}>
              {RANGE_LABEL[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={brand} onValueChange={(v) => setBrand(v as BrandFilter)}>
        <SelectTrigger className="h-9 w-[150px]" aria-label="מותג">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BRAND_FILTERS.map((b) => (
            <SelectItem key={b} value={b}>
              {BRAND_FILTER_LABEL[b]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
