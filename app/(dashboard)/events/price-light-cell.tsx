"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { recheckEvent, listEventMatches } from "@/lib/actions/price-light-actions";
import { lightLabel, signedUsd } from "@/lib/services/price-light";
import type { Event } from "@/types/app.types";
import type { Light, ListingRow, MatchRow } from "@/types/price-light.types";
import { isLight, LIGHT_SORT_ORDER, Pill } from "./price-light-ui";

// Re-exported for events-table.tsx, which imports these from this file - the
// values themselves now live in price-light-ui.tsx (shared with /price-light).
export { LIGHT_SORT_ORDER, isLight };

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
        <Pill scope="חב׳" detail={detail?.package} light={pkg} />
        <Pill scope="כר׳" detail={detail?.ticket} light={tkt} />
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
                      {/* ISSTA/OnTour listings carry no match date - the travel window is the
                          only thing that explains why this listing was paired with our event,
                          so show it in its place rather than an empty gap (final review, I4). */}
                      {l && <a href={l.url} target="_blank" rel="noreferrer" className="text-xs underline">{l.title} · {l.event_date ?? (l.travel_depart && l.travel_return ? `נסיעה ${l.travel_depart}–${l.travel_return}` : "—")} · {l.price_from} {l.currency}</a>}
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
