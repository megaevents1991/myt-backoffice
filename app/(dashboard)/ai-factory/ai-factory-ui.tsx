// Shared presentation for the AI Factory (spec docs/superpowers/specs/2026-09-16-price-light-gaps-ai-factory-design.md
// §5, §8): the switch-state pill both `/ai-factory` and `/ai-factory/[key]` show, and the
// maturity-rate line every screen that mentions a rate needs to word the same way.
import type { AgentSwitchState } from "@/types/ai-factory.types";

export const SWITCH_LABEL: Record<AgentSwitchState, string> = {
  on: "פעיל",
  off: "כבוי",
  key_missing: "מפתח חסר",
  master_off: "כבוי (מפסק ראשי)",
};

// Same emerald/amber/red/muted convention as the price-light pill (app/(dashboard)/events/price-light-ui.tsx).
export const SWITCH_BADGE: Record<AgentSwitchState, string> = {
  on: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  off: "bg-muted text-muted-foreground",
  key_missing: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  master_off: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
};

/** "62%" or the "not enough decisions yet" line - used on the overview card and the maturity tab. */
export function maturityRateText(rate: number | null): string {
  return rate == null ? "אין מספיק החלטות" : `${Math.round(rate * 100)}%`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}
