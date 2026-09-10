"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { recheckEvent, listEventMatches } from "@/lib/actions/price-light-actions";
import { lightLabel, signedUsd } from "@/lib/services/price-light";
import type { Event } from "@/types/app.types";
import { LIGHTS, type Light, type LightScopeDetail, type ListingRow, type MatchRow, type UncheckedReason } from "@/types/price-light.types";

// Sort order for the "רמזור" column (worst first): red > orange > unchecked >
// green > alone > na. Defined here (not in the pure engine) per the price-light
// design's "presentation stays in the UI" split.
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

const PILL: Record<Light, string> = {
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
function heLabel(light: Light, diffUsd: number | null): string {
  switch (light) {
    case "alone": return "לבד בשוק";
    case "unchecked": return "לא נבדק";
    case "na": return "—";
    default: return signedUsd(diffUsd ?? 0);
  }
}

const HE_REASON: Record<UncheckedReason, string> = {
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

function Pill({ scope, detail, light }: { scope: "Pkg" | "Tkt"; detail: LightScopeDetail | undefined; light: Light }) {
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

export function PriceLightCell({ event, onUpdated }: { event: Event; onUpdated: (patch: Partial<Event>) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ matches: MatchRow[]; listings: Record<number, ListingRow> } | null>(null);
  const { toast } = useToast();
  const detail = event.light_detail ?? null;
  const pkg: Light = isLight(event.light_package) ? event.light_package : "unchecked";
  const tkt: Light = isLight(event.light_ticket) ? event.light_ticket : "unchecked";

  const openHistory = async () => {
    setOpen(true);
    try {
      setHistory(await listEventMatches(event.id));
    } catch (e) {
      console.error("listEventMatches failed", e);
      toast({ variant: "destructive", title: "History failed", description: e instanceof Error ? e.message : "failed" });
    }
  };

  const recheck = async () => {
    setBusy(true);
    try {
      const res = await recheckEvent(event.id);
      if (!res.ok) {
        toast({ variant: "destructive", title: "Recheck failed", description: res.error });
        return;
      }
      onUpdated({
        light_package: res.lights.package,
        light_ticket: res.lights.ticket,
        light_detail: res.detail,
        light_checked_at: res.checked_at,
      });
      toast({ title: "Rechecked", description: `package ${res.lights.package ?? "—"} · ticket ${res.lights.ticket ?? "—"}` });
      if (open) setHistory(await listEventMatches(event.id));
    } catch (e) {
      console.error("recheck failed", e);
      toast({ variant: "destructive", title: "Recheck failed", description: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={openHistory} className="flex items-center gap-1" title="History">
        <Pill scope="Pkg" detail={detail?.package} light={pkg} />
        <Pill scope="Tkt" detail={detail?.ticket} light={tkt} />
      </button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={recheck} disabled={busy} title="Recheck against stored catalogs">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[520px] overflow-y-auto sm:max-w-[520px]">
          <SheetHeader><SheetTitle>Price light · {event.name}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3 text-sm">
            {detail?.package && <p>Package: our ${detail.package.our_usd ?? "—"} · {lightLabel(detail.package)}</p>}
            {detail?.ticket && <p>Ticket: our ${detail.ticket.our_usd ?? "—"} · {lightLabel(detail.ticket)}</p>}
            {event.price_drop_usd != null && event.price_drop_until && event.price_drop_until >= new Date().toISOString().slice(0, 10) && (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                ירידת מחיר: {signedUsd(-Math.abs(event.price_drop_usd))}
                {event.price_drop_from != null ? ` (מ-$${event.price_drop_from})` : ""} · עד {event.price_drop_until}
              </p>
            )}
            {!history ? <p className="text-muted-foreground">Loading…</p> : history.matches.length === 0 ? <p className="text-muted-foreground">No checks yet.</p> : (
              <ul className="divide-y">
                {history.matches.map((m) => {
                  const l = m.listing_id ? history.listings[m.listing_id] : null;
                  return (
                    <li key={m.id} className="py-2 text-xs">
                      <div className="flex justify-between font-medium text-sm">
                        <span>{m.competitor} · {m.scope}</span>
                        <span className="text-muted-foreground">{new Date(m.created_at).toLocaleString("he-IL")}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {m.status}
                        {" · normalized "}{m.normalized_usd != null ? `$${m.normalized_usd}` : "—"}
                        {" · our "}{m.our_usd != null ? `$${m.our_usd}` : "—"}
                        {" · diff "}{m.diff_usd != null ? signedUsd(Number(m.diff_usd)) : "—"}
                        {" · "}{m.method}
                        {m.note ? ` · ${m.note}` : ""}
                      </div>
                      {l && <a href={l.url} target="_blank" rel="noreferrer" className="text-xs underline">{l.title} · {l.event_date} · {l.price_from} {l.currency}</a>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
