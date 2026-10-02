"use client";

/**
 * The departure card: a side sheet with five tabs (general, prices, promotions,
 * flights, sales). Opened from a board row or straight from `?code=`.
 *
 * It owns one piece of data - the card payload - and reloads it after every
 * change, then tells the board which departure to refresh. The sheet, the
 * load and the top of the header are shared with the viewer's card
 * (departure-sheet.tsx).
 */
import { useCallback, useMemo, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Notice } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast, type ActionAnswer } from "@/hooks/use-action-toast";
import { toPriceMatrix } from "@/lib/tours/pricing";
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
import { DepartureSheet, DepartureSheetHeader, type CardTarget } from "./departure-sheet";
import { effectiveRoute, publishBlockers, siteSaleStatus } from "./departure-utils";
import type { BoardPeriod, DepartureCardData } from "./types";
import { SaleStatusSelect, usePublishToast } from "./ui-bits";

interface CardProps {
  tab: CardTab;
  onTabChange: (tab: CardTab) => void;
  periods: BoardPeriod[];
  onClose: () => void;
  /** A departure changed (or was created / deleted) - the board refreshes that row. */
  onChanged: (departureId: string) => void;
}

export function DepartureCard({ target, ...card }: CardProps & { target: CardTarget | null }) {
  const runAction = useActionToast();
  // The first load shows its failure in the sheet. A reload after a change goes by id,
  // keeps the card on screen and reports a failure in a toast.
  const load = (ref: CardTarget, current: DepartureCardData | null) =>
    current ? runAction(() => getDepartureCard({ id: current.departure.id })) : getDepartureCard(ref);
  return (
    <DepartureSheet target={target} onClose={card.onClose} load={load}>
      {(data, reload) => <StaffCard data={data} reload={reload} {...card} />}
    </DepartureSheet>
  );
}

function StaffCard({
  data,
  reload,
  tab,
  onTabChange,
  periods,
  onClose,
  onChanged,
}: CardProps & { data: DepartureCardData; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const runAction = useActionToast();
  const publishToast = usePublishToast();
  const d = data.departure;
  const departureId = d.id;

  /** Reload the card after a change and let the board refresh the row. */
  const refresh = useCallback(async () => {
    await reload();
    onChanged(departureId);
  }, [departureId, reload, onChanged]);

  const derived = useMemo(() => {
    const dep = data.departure;
    const route = effectiveRoute(dep, data.series);
    const blockers = publishBlockers({
      start_date: dep.start_date,
      end_date: dep.end_date,
      currency: dep.currency,
      route,
      prices: toPriceMatrix(data.prices),
      options: data.options,
      flight_mode: dep.flight_mode,
      flight_price: dep.flight_price,
      markup_fixed: dep.markup_fixed,
    });
    return {
      route,
      blockers,
      activePromotions: data.promotions.filter((p) => p.is_active),
      siteStatus: siteSaleStatus({ sale_status: dep.sale_status, allocated: data.stats.allocated, remaining: data.stats.remaining }),
    };
  }, [data]);

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
    setBusy(true);
    const result = await runAction(() => setDeparturesPublished([d.id], next));
    setBusy(false);
    if (result.success && publishToast(result.data, next)) await refresh();
  };

  const remove = async () => {
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

  return (
    <>
      <DepartureSheetHeader
        departure={d}
        route={derived.route}
        tourPage={data.package?.name ?? "Tour page not found"}
        series={data.series}
        periods={periods}
      >
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
        {derived.siteStatus !== d.sale_status && !d.is_deleted && (
          <Notice tone="info" className="py-1.5 text-xs">
            {data.stats.remaining > 0 ? `${data.stats.remaining} seats left` : "No seats left"}, so the site shows this date
            as &quot;{SALE_STATUS_LABELS[derived.siteStatus as SaleStatus] ?? derived.siteStatus}&quot; on its own. It goes back to
            &quot;{SALE_STATUS_LABELS[d.sale_status as SaleStatus] ?? d.sale_status}&quot; by itself when seats free up.
          </Notice>
        )}
      </DepartureSheetHeader>

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
  );
}
