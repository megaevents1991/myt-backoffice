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
  type CompetitorKey,
  type Light,
  type LightOverride,
  type LightScopeDetail,
  type UncheckedReason,
} from "@/types/price-light.types";

// Staff-facing display names for competitor keys - used in the pill tooltip
// here and in the competitors panel's card title (competitors-panel.tsx).
export const COMPETITOR_LABEL: Record<CompetitorKey, string> = {
  liveevents: "LiveEvents",
  issta: "ISSTA Sport",
  golasso: "Golasso",
  ontour: "OnTour",
  livetickets: "LiveTickets",
};

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
  quote_only: "מתחרה מוכר בהצעת מחיר בלבד",
};

/**
 * The duration line - the first thing to check when a comparison looks wrong, because our
 * packages are often a night longer than the competitor's. Reads:
 *   "לילות: 4 שלנו מול 3 שלהם"              - measured both sides, priced into the adjustment
 *   "לילות: 4 שלנו · אצלהם לא פורסם (±$138)" - unknown their side, so the light's band widened
 * Null for a ticket-scope light (a ticket has no duration) and for rows written before the
 * field existed.
 */
function nightsLine(detail: LightScopeDetail): string | null {
  const n = detail.nights;
  if (!n) return null;
  const ours = n.ours == null ? "לא ידוע" : `${n.ours}`;
  if (typeof n.theirs === "number") return `לילות: ${ours} שלנו מול ${n.theirs} שלהם`;
  const band = detail.uncertainty_usd ? ` (±$${detail.uncertainty_usd})` : "";
  return `לילות: ${ours} שלנו · אצלהם לא פורסם${band}`;
}

// Hebrew throughout: this tooltip sits on the events table, where every other string is
// Hebrew, and it is the whole explanation behind a coloured pill.
function tipFor(detail: LightScopeDetail | undefined, pkg: boolean): string {
  if (!detail) return "טרם נבדק";
  if (detail.light === "green" || detail.light === "orange" || detail.light === "red") {
    return [
      // `?? "מתחרה"`, never a literal "null": detail.competitor can be null on a light that
      // was set without a named competitor (final review, M10). The listing's travel window
      // is NOT available here - LightScopeDetail carries no window fields - so the trip dates
      // live in the history sheet (price-light-cell.tsx), which has the listing row itself.
      `${(detail.competitor ? COMPETITOR_LABEL[detail.competitor] : null) ?? "מתחרה"}: ${detail.raw ?? "?"} ${detail.raw_currency ?? ""} → מנורמל $${detail.normalized_usd}`,
      // Package: the margin-free "from" price the light compares (2026-09-17), not the site price.
      detail.our_usd != null ? `${pkg ? "החל מ- (שלנו)" : "שלנו"}: $${detail.our_usd}` : null,
      nightsLine(detail),
      ...detail.adjustments.map((a) => a.label),
      // The NORMALIZATION gap (the competitor's page never said what its package contains), not
      // the coverage one - renamed 2026-09-17 in step with /price-light's own tooltip.
      detail.partial ? "נרמול חלקי (חסרים פרטי חבילה)" : null,
      detail.crawled_at ? `נסרק ${detail.crawled_at.slice(0, 10)}` : null,
    ].filter(Boolean).join("\n");
  }
  if (detail.light === "alone") return "כל המתחרים הפעילים נבדקו, אף אחד לא מוכר את האירוע";
  if (detail.light === "na") return "לא רלוונטי לאירוע הזה";
  return detail.reason ? HE_REASON[detail.reason] : "טרם נבדק";
}

/** `scope` is the two-letter shoulder on the pill: Hebrew, like everything else on the table.
 *  `override` is the event's manual override WHEN it is the one on this scope: the pill's colour is
 *  the forced light, so the tooltip must say so, not explain the computed light it replaced. */
export function Pill({ scope, detail, light, override }: {
  scope: "חב׳" | "כר׳"; detail: LightScopeDetail | undefined; light: Light; override?: LightOverride | null;
}) {
  const tip = override && override.light === light
    ? [`דריסה ידנית: ${override.note}`, override.by ? `ע״י ${override.by}` : null, `חישוב אוטומטי: ${tipFor(detail, scope === "חב׳")}`].filter(Boolean).join("\n")
    : tipFor(detail, scope === "חב׳");
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${PILL[light]}`}>
            <span className="opacity-70">{scope}</span>
            {heLabel(light, detail?.diff_usd ?? null)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
