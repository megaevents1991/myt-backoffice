"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { afterUrlWrite, useQueryState } from "@/hooks/use-view-state";
import type { MarketingQuery } from "@/lib/actions/marketing-actions";
import { israelToday, resolveWindow, type MarketingWindow } from "@/lib/marketing/range";
import { parseSource, SOURCE_FILTERS, SOURCE_LABEL, type SourceFilter } from "@/lib/marketing/order-source";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import type { AdBrand, AdPlatform } from "@/types/marketing.types";
import { DateRangePicker, type DatePreset } from "@/components/date-range-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * What every marketing tab shares (spec 2026-10-14 section 1): ONE filter bar above the tabs - period, currency,
 * brand, source - kept in the URL (`range`, `from`, `to`, `cur`, `brand`, `src`), so a refresh or a pasted link
 * lands on the same view; the money format; the POAS colours; one loader hook per tab.
 */

export const BRAND_FILTERS = ["mega_events", "other", "all"] as const;
export type BrandFilter = (typeof BRAND_FILTERS)[number];

export const BRAND_FILTER_LABEL: Record<BrandFilter, string> = {
  mega_events: "Mega Events",
  other: "Other brand",
  all: "All brands",
};

export const BRAND_LABEL: Record<AdBrand, string> = { mega_events: "Mega Events", other: "Other brand" };
export const PLATFORM_LABEL: Record<AdPlatform, string> = { meta: "Meta", google: "Google" };

export const PERIOD_PRESETS: DatePreset[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
];

/** "1 order" / "3 orders" - the count line under the cards and in the side cards. */
export const ordersText = (n: number): string => `${n} order${n === 1 ? "" : "s"}`;

const formats: Record<MarketingCurrency, Intl.NumberFormat> = {
  ils: new Intl.NumberFormat("en-US", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }),
  usd: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
};
/** Money in the screen's currency, whole units ("₪32,346" / "$8,740"). */
export const money = (n: number, cur: MarketingCurrency): string => formats[cur].format(n);
export const CURRENCY_SIGN: Record<MarketingCurrency, string> = { ils: "₪", usd: "$" };

/** POAS colour: below 0 red (the campaign loses money), 0..1 amber, above 1 green. No number = neutral. */
export function poasTone(poas: number | null): string {
  if (poas === null) return "";
  if (poas < 0) return "text-destructive";
  if (poas <= 1) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/** Next replaces what a server action threw with its own text in a production build ("An error occurred in the
 *  Server Components render. The specific message is omitted ..."), with a digest the server log carries. */
const MASKED_PROD_ERROR = /An error occurred in the Server Components render/i;

export function errorText(e: unknown): string {
  if (!(e instanceof Error) || !e.message) return "Failed to load";
  const hasDigest = "digest" in e || /digest/i.test(e.message);
  if (MASKED_PROD_ERROR.test(e.message) || (/Server Action/i.test(e.message) && hasDigest)) {
    return "Loading failed - details are in the server logs";
  }
  return e.message;
}

// ---- the filters (one instance, in MarketingClient; every tab reads it from the context)

const FILTER_KEYS = ["range", "from", "to", "cur", "brand", "src"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export interface MarketingFilters {
  /** What the server actions take - the raw URL values; the server validates them again. */
  query: MarketingQuery;
  window: MarketingWindow;
  cur: MarketingCurrency;
  brand: BrandFilter;
  src: SourceFilter;
  set: (patch: Partial<Record<FilterKey, string>>) => void;
}

const FiltersContext = createContext<MarketingFilters | null>(null);

export function MarketingFiltersProvider({ children }: { children: ReactNode }) {
  const [values, set] = useQueryState(FILTER_KEYS);
  const filters = useMemo<MarketingFilters>(() => {
    const window = resolveWindow({ range: values.range, from: values.from, to: values.to });
    const cur: MarketingCurrency = values.cur === "usd" ? "usd" : "ils";
    const brand: BrandFilter = (BRAND_FILTERS as readonly string[]).includes(values.brand) ? (values.brand as BrandFilter) : "mega_events";
    const src = parseSource(values.src);
    const query: MarketingQuery = { range: window.range, from: window.since, to: window.until, cur, brand, src };
    return { query, window, cur, brand, src, set };
  }, [values, set]);
  return <FiltersContext.Provider value={filters}>{children}</FiltersContext.Provider>;
}

export function useMarketingFilters(): MarketingFilters {
  const f = useContext(FiltersContext);
  if (!f) throw new Error("useMarketingFilters outside MarketingFiltersProvider");
  return f;
}

/**
 * Load one tab's data whenever the filters change. A load that fails lands in `error` (shown inline) - the actions
 * THROW on a database error, and an empty state would read as "nothing to see". `afterUrlWrite` first: a filter
 * change writes the URL, and an action queued during the router's restore is dropped (hooks/use-view-state.ts).
 */
export function useMarketingLoad<T>(load: (q: MarketingQuery) => Promise<T>): { data: T | null; error: string | null; loading: boolean } {
  const { query } = useMarketingFilters();
  const key = JSON.stringify(query);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      await afterUrlWrite();
      try {
        const result = await load(JSON.parse(key) as MarketingQuery);
        if (!cancelled) setData(result);
      } catch (e) {
        console.error("Error loading the marketing view:", e);
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
    // `load` is a module-level server action - stable; the filters are the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, loading };
}

/** The bar above the tabs. `showSource` is off on tabs the source filter means nothing to (Instagram, Alerts). */
export function MarketingFilterBar({ showSource = true }: { showSource?: boolean }) {
  const { window, cur, brand, src, set } = useMarketingFilters();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangePicker
        presets={PERIOD_PRESETS}
        preset={window.range}
        from={window.since}
        to={window.until}
        maxDay={israelToday()}
        onPreset={(id) => set({ range: id === "30d" ? "" : id, from: "", to: "" })}
        onRange={(from, to) => set({ range: "custom", from, to })}
      />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={cur}
        onValueChange={(v) => v && set({ cur: v === "ils" ? "" : v })}
        aria-label="Currency"
      >
        <ToggleGroupItem value="ils" aria-label="Shekels" className="h-9 px-3">₪</ToggleGroupItem>
        <ToggleGroupItem value="usd" aria-label="Dollars" className="h-9 px-3">$</ToggleGroupItem>
      </ToggleGroup>
      <Select value={brand} onValueChange={(v) => set({ brand: v === "mega_events" ? "" : v })}>
        <SelectTrigger className="h-9 w-[150px]" aria-label="Brand">
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
      {showSource && (
        <Select value={src} onValueChange={(v) => set({ src: v === "all" ? "" : v })}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
