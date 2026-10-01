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
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/confirm-provider";
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
import {
  effectiveRoute,
  fmtDate,
  fmtDateRange,
  nightsBetween,
  periodLabel,
  periodsOverlapping,
  publishBlockers,
  suggestedSaleStatus,
} from "./departure-utils";
import type { BoardPeriod, DepartureCardData } from "./types";
import { Chip, Ltr, Notice, SaleStatusSelect, Toggle } from "./ui-bits";
import { afterUrlWrite } from "./use-query-state";

export interface CardTarget {
  id?: string;
  code?: string;
}

const RLM = "‏";

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
  const targetId = target?.id;
  const targetCode = target?.code;

  const load = useCallback(async (ref: CardTarget, quiet: boolean) => {
    if (!quiet) setLoading(true);
    // Opening the card writes `?code=` first; let the router settle before queueing the action.
    await afterUrlWrite();
    const result = await getDepartureCard(ref);
    if (result.success) {
      setData(result.data);
      setError(null);
    } else if (!quiet) {
      setData(null);
      setError(result.error);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }, []);

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

  const run = async (work: () => Promise<{ success: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? "הפעולה נכשלה");
      return false;
    }
    if (done) toast.success(done);
    await refresh();
    return true;
  };

  const togglePublished = async (next: boolean) => {
    if (!data) return;
    setBusy(true);
    const result = await setDeparturesPublished([data.departure.id], next);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const skipped = result.data.skipped[0];
    if (skipped) {
      toast.error(`אי אפשר לפרסם: ${skipped.reason}`, { duration: 7000 });
      return;
    }
    const warning = result.data.warnings[0];
    if (warning) toast(`פורסם. ${warning.reason}`, { duration: 7000 });
    else toast.success(next ? "היציאה פורסמה" : "היציאה הוסרה מהפרסום");
    await refresh();
  };

  const remove = async () => {
    if (!data) return;
    const d = data.departure;
    const agreed = await confirm({
      title: `למחוק את היציאה ${d.code}?${RLM}`,
      description: `היציאה תסומן כמחוקה בתאריך של היום${d.is_published ? " ותרד מהאתר" : ""}. אפשר לשחזר אותה מהלוח (סינון "מחוקות").${data.allocations.length ? ` שימו לב: ${data.allocations.length} בלוקי טיסה נשארים משויכים אליה - הסירו את השיוך בלשונית טיסות כדי להחזיר את המושבים למאגר.` : ""}${RLM}`,
      confirmLabel: "מחיקה",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!agreed) return;
    if (await run(() => softDeleteDeparture(d.id), `היציאה ${d.code} נמחקה`)) onClose();
  };

  const d = data?.departure;

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {loading && !data ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">טוען יציאה</SheetTitle>
            <SheetDescription className="sr-only">כרטיס היציאה נטען</SheetDescription>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error || !data || !d || !derived ? (
          <div className="space-y-4 p-6">
            <SheetTitle>היציאה לא נטענה</SheetTitle>
            <SheetDescription className="sr-only">שגיאה בטעינת כרטיס היציאה</SheetDescription>
            <Notice tone="error">{error ?? "לא נמצאה יציאה"}</Notice>
            <Button variant="outline" onClick={onClose}>
              סגירה
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2 border-b pb-4 pe-6 ps-12 pt-5 text-start sm:text-start">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SheetTitle className="font-display text-xl">
                  <Ltr className="font-mono">{d.code}</Ltr>
                </SheetTitle>
                <Ltr className="text-sm tabular-nums text-muted-foreground">{fmtDateRange(d.start_date, d.end_date)}</Ltr>
                <span className="text-sm text-muted-foreground">{nightsBetween(d.start_date, d.end_date)} לילות</span>
                {departureRouteLabel(derived.route.arrival_airport, derived.route.return_airport) && (
                  <Ltr className="font-mono text-sm">{departureRouteLabel(derived.route.arrival_airport, derived.route.return_airport)}</Ltr>
                )}
                {derived.type && derived.type !== "round_trip" && (
                  <Chip className="border-info/30 bg-info-muted text-info">{ROUTE_TYPE_LABELS[derived.type]}</Chip>
                )}
                {d.is_deleted && (
                  <Chip className="border-destructive/30 bg-destructive/10 text-destructive">נמחקה ב-{fmtDate(d.is_deleted)}</Chip>
                )}
              </div>
              <SheetDescription>
                {data.package?.name ?? "עמוד לא נמצא"}
                {data.series && (
                  <>
                    {" · סדרה "}
                    <Ltr className="font-mono">{data.series.code}</Ltr>
                    {data.series.label ? ` (${data.series.label})` : ""}
                  </>
                )}
                {" · עונה "}
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
                  <Toggle
                    checked={d.is_published}
                    disabled={busy || Boolean(d.is_deleted)}
                    label={d.is_published ? "מפורסם באתר" : "לא מפורסם"}
                    onChange={togglePublished}
                  />
                  {d.is_published ? "מפורסם באתר" : "טיוטה, לא מפורסם"}
                </span>
                <SaleStatusSelect
                  value={d.sale_status}
                  disabled={busy || Boolean(d.is_deleted)}
                  onChange={(next) => run(() => updateDeparture(d.id, { sale_status: next }), `סטטוס המכירה: ${SALE_STATUS_LABELS[next]}`)}
                />
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <span className="ms-auto">
                  {d.is_deleted ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => restoreDeparture(d.id), "היציאה שוחזרה כטיוטה")}
                    >
                      <RotateCcw />
                      שחזור
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={remove}>
                      <Trash2 />
                      מחיקה
                    </Button>
                  )}
                </span>
              </div>
              {!d.is_published && !d.is_deleted && derived.blockers.length > 0 && (
                <p className="text-xs text-muted-foreground">כדי לפרסם חסר: {derived.blockers.join(" · ")}</p>
              )}
              {d.is_published && data.stats.liveBlocks === 0 && (
                <Notice tone="warning" className="py-1.5 text-xs">
                  היציאה מפורסמת בלי בלוק טיסה חי. האתר מציג &quot;פרטי הטיסות יעודכנו&quot;.
                </Notice>
              )}
              {derived.suggestion && !d.is_deleted && (
                <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                  <span>
                    {data.stats.remaining > 0 ? (
                      `נשארו ${data.stats.remaining} מקומות.`
                    ) : (
                      <>
                        אין מקומות פנויים (יתרה <Ltr>{data.stats.remaining}</Ltr>).
                      </>
                    )}{" "}
                    כדאי לשקול לשנות את סטטוס המכירה ל&quot;{SALE_STATUS_LABELS[derived.suggestion]}&quot;.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() => {
                      const next = derived.suggestion as SaleStatus;
                      void run(() => updateDeparture(d.id, { sale_status: next }), `סטטוס המכירה: ${SALE_STATUS_LABELS[next]}`);
                    }}
                  >
                    עדכון הסטטוס
                  </Button>
                </Notice>
              )}
            </SheetHeader>

            <Tabs dir="rtl" value={tab} onValueChange={(v) => onTabChange(v as CardTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-6 mt-3 grid h-9 grid-cols-5">
                <TabsTrigger value="general">כללי</TabsTrigger>
                <TabsTrigger value="prices">מחירים</TabsTrigger>
                <TabsTrigger value="promotions">
                  הטבות{derived.activePromotions.length ? ` (${derived.activePromotions.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="flights">טיסות{data.allocations.length ? ` (${data.allocations.length})` : ""}</TabsTrigger>
                <TabsTrigger value="sales">מכירות{data.stats.sold ? ` (${data.stats.sold})` : ""}</TabsTrigger>
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
