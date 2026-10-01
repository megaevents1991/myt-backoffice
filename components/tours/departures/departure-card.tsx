"use client";

/**
 * The departure card: a side sheet with five tabs (general, prices, promotions,
 * flights, sales). Opened from a board row or straight from `?code=`.
 *
 * It owns one piece of data - the card payload - and reloads it after every
 * change, then tells the board which departure to refresh.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Chip, Ltr, Notice } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast, type ActionAnswer } from "@/hooks/use-action-toast";
import { useToast } from "@/hooks/use-toast";
import { afterUrlWrite } from "@/hooks/use-view-state";
import { fmtDate, fmtDateRange, nightsBetween } from "@/lib/tours/format";
import { toPriceMatrix } from "@/lib/tours/pricing";
import { ROUTE_TYPE_LABELS, departureRouteLabel, routeType } from "@/lib/tours/routes";
import { SALE_STATUS_LABELS, type SaleStatus } from "@/types/tours.types";
import {
  getDepartureCard,
  restoreDeparture,
  setDeparturesPublished,
  softDeleteDeparture,
  updateDeparture,
} from "@/lib/actions/tours-departure-actions";
import type { CardTab } from "./board-row";
import { CardFlightsTab } from "./card-flights-tab";
import { CardGeneralTab } from "./card-general-tab";
import { CardPricesTab } from "./card-prices-tab";
import { CardPromotionsTab } from "./card-promotions-tab";
import { CardSalesTab } from "./card-sales-tab";
import { effectiveRoute, periodLabel, periodsOverlapping, publishBlockers, suggestedSaleStatus } from "./departure-utils";
import type { BoardPeriod, DepartureCardData } from "./types";
import { SaleStatusSelect } from "./ui-bits";

export interface CardTarget {
  id?: string;
  code?: string;
}

export function DepartureCard({
  target,
  tab,
  onTabChange,
  periods,
  onClose,
  onChanged,
}: {
  target: CardTarget | null;
  tab: CardTab;
  onTabChange: (tab: CardTab) => void;
  periods: BoardPeriod[];
  onClose: () => void;
  /** A departure changed (or was created / deleted) - the board refreshes that row. */
  onChanged: (departureId: string) => void;
}) {
  const [data, setData] = useState<DepartureCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const runAction = useActionToast();
  const { toast } = useToast();
  const targetId = target?.id;
  const targetCode = target?.code;

  const load = useCallback(async (ref: CardTarget, quiet: boolean) => {
    if (!quiet) setLoading(true);
    // Opening the card writes `?code=` first; let the router settle before queueing the action.
    await afterUrlWrite();
    // A first load shows its failure in the sheet; a quiet reload keeps the card and reports it in a toast.
    const result = quiet ? await runAction(() => getDepartureCard(ref)) : await getDepartureCard(ref);
    if (result.success) {
      setData(result.data);
      setError(null);
    } else if (!quiet) {
      setData(null);
      setError(result.error);
    }
    setLoading(false);
  }, [runAction]);

  useEffect(() => {
    if (!targetId && !targetCode) {
      setData(null);
      setError(null);
      return;
    }
    void load({ id: targetId, code: targetCode }, false);
  }, [targetId, targetCode, load]);

  const departureId = data?.departure.id;
  /** Reload the card after a change and let the board refresh the row. */
  const refresh = useCallback(async () => {
    if (!departureId) return;
    await load({ id: departureId }, true);
    onChanged(departureId);
  }, [departureId, load, onChanged]);

  const derived = useMemo(() => {
    if (!data) return null;
    const d = data.departure;
    const route = effectiveRoute(d, data.series);
    const ownPromotions = data.promotions.filter((p) => p.is_active);
    const blockers = publishBlockers({
      start_date: d.start_date,
      end_date: d.end_date,
      currency: d.currency,
      route,
      prices: toPriceMatrix(data.prices),
      options: data.options,
      flight_mode: d.flight_mode,
      flight_price: d.flight_price,
      markup_fixed: d.markup_fixed,
    });
    return {
      route,
      type: routeType(route.arrival_airport, route.return_airport),
      blockers,
      activePromotions: ownPromotions,
      holidays: periodsOverlapping(periods, d.start_date, d.end_date),
      suggestion: suggestedSaleStatus({ sale_status: d.sale_status, allocated: data.stats.allocated, remaining: data.stats.remaining }),
    };
  }, [data, periods]);

  /** Run a card action with the shared toast, then reload the card. */
  const run = async (work: () => Promise<ActionAnswer>, done?: string) => {
    setBusy(true);
    const result = await runAction(work, done);
    setBusy(false);
    if (!result.success) return false;
    await refresh();
    return true;
  };

  const togglePublished = async (next: boolean) => {
    if (!data) return;
    setBusy(true);
    const result = await runAction(() => setDeparturesPublished([data.departure.id], next));
    setBusy(false);
    if (!result.success) return;
    const skipped = result.data.skipped[0];
    if (skipped) {
      toast({ variant: "destructive", title: "Can't publish", description: skipped.reason, duration: 7000 });
      return;
    }
    const warning = result.data.warnings[0];
    if (warning) toast({ title: "Published", description: warning.reason, duration: 7000 });
    else toast({ title: next ? "Departure published" : "Departure unpublished" });
    await refresh();
  };

  const remove = async () => {
    if (!data) return;
    const d = data.departure;
    const agreed = await confirm({
      title: `Delete departure ${d.code}?`,
      description: `The departure will be marked as deleted as of today${d.is_published ? " and taken off the site" : ""}. You can restore it from the board (the "Deleted" filter).${data.allocations.length ? ` Note: ${data.allocations.length} flight blocks stay allocated to it - remove the allocation in the Flights tab to return the seats to the pool.` : ""}`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!agreed) return;
    if (await run(() => softDeleteDeparture(d.id), `Departure ${d.code} deleted`)) onClose();
  };

  const d = data?.departure;

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {loading && !data ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">Loading departure</SheetTitle>
            <SheetDescription className="sr-only">The departure card is loading</SheetDescription>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error || !data || !d || !derived ? (
          <div className="space-y-4 p-6">
            <SheetTitle>Departure failed to load</SheetTitle>
            <SheetDescription className="sr-only">Error loading the departure card</SheetDescription>
            <Notice tone="error">{error ?? "Departure not found"}</Notice>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2 border-b pb-4 pe-12 ps-6 pt-5 text-start sm:text-start">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SheetTitle className="font-display text-xl">
                  <Ltr className="font-mono">{d.code}</Ltr>
                </SheetTitle>
                <Ltr className="text-sm tabular-nums text-muted-foreground">{fmtDateRange(d.start_date, d.end_date)}</Ltr>
                <span className="text-sm text-muted-foreground">{nightsBetween(d.start_date, d.end_date)} nights</span>
                {departureRouteLabel(derived.route.arrival_airport, derived.route.return_airport) && (
                  <Ltr className="font-mono text-sm">{departureRouteLabel(derived.route.arrival_airport, derived.route.return_airport)}</Ltr>
                )}
                {derived.type && derived.type !== "round_trip" && (
                  <Chip className="border-info/30 bg-info-muted text-info">{ROUTE_TYPE_LABELS[derived.type]}</Chip>
                )}
                {d.is_deleted && (
                  <Chip className="border-destructive/30 bg-destructive/10 text-destructive">Deleted {fmtDate(d.is_deleted)}</Chip>
                )}
              </div>
              <SheetDescription>
                {data.package?.name ?? "Tour page not found"}
                {data.series && (
                  <>
                    {" · Series "}
                    <Ltr className="font-mono">{data.series.code}</Ltr>
                    {data.series.label ? ` (${data.series.label})` : ""}
                  </>
                )}
                {" · Season "}
                {d.season_year}
              </SheetDescription>
              {derived.holidays.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {derived.holidays.map((h) => (
                    <Chip key={h.id} className="border-warning/40 bg-warning-muted text-warning">
                      {periodLabel(h)}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                <span className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={d.is_published}
                    disabled={busy || Boolean(d.is_deleted)}
                    aria-label={d.is_published ? "Published on the site" : "Not published"}
                    title={d.is_published ? "Published on the site" : "Not published"}
                    onCheckedChange={togglePublished}
                  />
                  {d.is_published ? "Published on the site" : "Draft, not published"}
                </span>
                <SaleStatusSelect
                  value={d.sale_status}
                  disabled={busy || Boolean(d.is_deleted)}
                  onChange={(next) => run(() => updateDeparture(d.id, { sale_status: next }), `Sale status: ${SALE_STATUS_LABELS[next]}`)}
                />
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <span className="ms-auto">
                  {d.is_deleted ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => restoreDeparture(d.id), "Departure restored as a draft")}
                    >
                      <RotateCcw />
                      Restore
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={remove}>
                      <Trash2 />
                      Delete
                    </Button>
                  )}
                </span>
              </div>
              {!d.is_published && !d.is_deleted && derived.blockers.length > 0 && (
                <p className="text-xs text-muted-foreground">Can&apos;t publish yet: {derived.blockers.join(" · ")}</p>
              )}
              {d.is_published && data.stats.liveBlocks === 0 && (
                <Notice tone="warning" className="py-1.5 text-xs">
                  The departure is published without a live flight block. The site shows &quot;flight details will be updated&quot;.
                </Notice>
              )}
              {derived.suggestion && !d.is_deleted && (
                <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                  <span>
                    {data.stats.remaining > 0 ? (
                      `${data.stats.remaining} seats left.`
                    ) : (
                      <>
                        No seats left (balance <Ltr>{data.stats.remaining}</Ltr>).
                      </>
                    )}{" "}
                    Consider changing the sale status to &quot;{SALE_STATUS_LABELS[derived.suggestion]}&quot;.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() => {
                      const next = derived.suggestion as SaleStatus;
                      void run(() => updateDeparture(d.id, { sale_status: next }), `Sale status: ${SALE_STATUS_LABELS[next]}`);
                    }}
                  >
                    Update Status
                  </Button>
                </Notice>
              )}
            </SheetHeader>

            <Tabs value={tab} onValueChange={(v) => onTabChange(v as CardTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-6 mt-3 grid h-9 grid-cols-5">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="prices">Prices</TabsTrigger>
                <TabsTrigger value="promotions">
                  Promotions{derived.activePromotions.length ? ` (${derived.activePromotions.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="flights">Flights{data.allocations.length ? ` (${data.allocations.length})` : ""}</TabsTrigger>
                <TabsTrigger value="sales">Reservations{data.stats.sold ? ` (${data.stats.sold})` : ""}</TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2">
                <TabsContent value="general">
                  <CardGeneralTab key={d.updated_at} data={data} onSaved={refresh} />
                </TabsContent>
                <TabsContent value="prices" className="pb-8">
                  <CardPricesTab key={d.updated_at} data={data} onSaved={refresh} />
                </TabsContent>
                <TabsContent value="promotions" className="pb-8">
                  <CardPromotionsTab data={data} onSaved={refresh} />
                </TabsContent>
                <TabsContent value="flights" className="pb-8">
                  <CardFlightsTab data={data} route={derived.route} onSaved={refresh} />
                </TabsContent>
                <TabsContent value="sales" className="pb-8">
                  <CardSalesTab data={data} onSaved={refresh} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
