"use client";

// Shared presentation layer for the price light (רמזור): the events-table
// cell (price-light-cell.tsx, phase 0) and the /price-light screen
// (price-light-client.tsx, phase 1) both render the same light pill and the
// same Hebrew labels - this is the one place that owns them.
//
// Pure engine values (lightLabel, signedUsd, the diff/threshold math) stay in
// lib/services/price-light.ts; everything here is presentation-only, per the
// price-light design's "presentation stays in the UI" split.
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { signedUsd } from "@/lib/services/price-light";
import {
  LIGHTS,
  type Light,
  type LightScopeDetail,
  type UncheckedReason,
} from "@/types/price-light.types";

/** Sort order for the "רמזור" column (worst first): red > orange > unchecked > green > alone > na. */
export const LIGHT_SORT_ORDER: Record<Light, number> = {
  red: 0,
  orange: 1,
  unchecked: 2,
  green: 3,
  alone: 4,
  na: 5,
};

/** Narrows a raw DB string to `Light` instead of trusting it with a bare `as Light`. */
export function isLight(v: string | null | undefined): v is Light {
  return v != null && (LIGHTS as readonly string[]).includes(v);
}

export const PILL: Record<Light, string> = {
  alone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  green: "bg-emerald-700 text-white dark:bg-emerald-600",
  orange: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  red: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  unchecked: "bg-muted text-muted-foreground",
  na: "bg-transparent text-muted-foreground",
};

// Hebrew labels for the pill itself (per controller ruling - pill labels must be Hebrew).
// The engine's `lightLabel` (lib/services/price-light.ts) stays English/pure and shared;
// this is presentation-only, same split as LIGHT_SORT_ORDER above.
export function heLabel(light: Light, diffUsd: number | null): string {
  switch (light) {
    case "alone": return "לבד בשוק";
    case "unchecked": return "לא נבדק";
    case "na": return "—";
    default: return signedUsd(diffUsd ?? 0);
  }
}

export const HE_REASON: Record<UncheckedReason, string> = {
  never: "טרם נבדק",
  stale: "מידע ישן",
  crawl_failed: "סריקה נכשלה",
  unsure: "לא ודאי",
  partial_coverage: "כיסוי חלקי",
};

function tipFor(detail: LightScopeDetail | undefined): string {
  if (!detail) return "not checked yet";
  if (detail.light === "green" || detail.light === "orange" || detail.light === "red") {
    return [
      `${detail.competitor}: raw ${detail.raw ?? "?"} ${detail.raw_currency ?? ""} → normalized $${detail.normalized_usd}`,
      ...detail.adjustments.map((a) => a.label),
      detail.partial ? "partial normalization" : null,
      detail.crawled_at ? `crawled ${detail.crawled_at.slice(0, 10)}` : null,
    ].filter(Boolean).join("\n");
  }
  if (detail.light === "alone") return "all active competitors checked - none sells it";
  if (detail.light === "na") return "not applicable for this event";
  return detail.reason ? HE_REASON[detail.reason] : "not checked yet";
}

export function Pill({ scope, detail, light }: { scope: "Pkg" | "Tkt"; detail: LightScopeDetail | undefined; light: Light }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${PILL[light]}`}>
            <span className="opacity-70">{scope}</span>
            {heLabel(light, detail?.diff_usd ?? null)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line text-xs">{tipFor(detail)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
