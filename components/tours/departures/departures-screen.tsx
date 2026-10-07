"use client";

/**
 * Tours > Departures for staff: Departures and Pricing as one table (Alon,
 * 04.10.2026). The sheet (components/tours/pricing/pricing-sheet.tsx) shows
 * every sub-tour of the organized tours, tour by tour, with a Departures /
 * Prices / Details switch over the same rows; it is edited like a spreadsheet
 * and saved with one button. A code opens the departure card here, in place.
 *
 * The address still speaks the board's language, so every link to it keeps
 * working: `?code=CBP927` opens that card, `?tab=` its tab, `?page=<tour id>` /
 * `?tour=` starts on one tour, `?series=CBP` on one series, `?view=prices` on
 * the price columns. The old board - the only screen that lists vacation
 * packages and deleted dates - stays one click away (`?board=classic`), and is
 * what a read-only sales agent gets.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, LayoutList, MoreHorizontal, PlusCircle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { PricingSheet } from "@/components/tours/pricing/pricing-sheet";
import { SHEET_VIEWS, type SheetView } from "@/components/tours/pricing/sheet-model";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActionData } from "@/hooks/use-action-data";
import { afterUrlWrite, useQueryState } from "@/hooks/use-view-state";
import { getSeriesScreen } from "@/lib/actions/tours-series-actions";
import { NewDepartureDialog } from "./board-dialogs";
import type { CardTab } from "./board-row";
import { DepartureCard } from "./departure-card";
import type { CardTarget } from "./departure-sheet";

const CARD_TABS: readonly CardTab[] = ["general", "prices", "promotions", "flights", "sales"];
const QUERY_KEYS = ["code", "tab", "view", "tour", "page", "series", "season", "status", "q"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DeparturesScreen() {
  const [params, setParams] = useQueryState(QUERY_KEYS);
  // series, tours and holiday periods: what Add Departure and the card need
  const context = useActionData(() => getSeriesScreen(), []);
  const [cardTarget, setCardTarget] = useState<CardTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const tab: CardTab = (CARD_TABS as readonly string[]).includes(params.tab) ? (params.tab as CardTab) : "general";
  const view: SheetView = (SHEET_VIEWS as readonly string[]).includes(params.view) ? (params.view as SheetView) : "departures";
  const focusTour = [params.tour, params.page].find((id) => UUID.test(id)) ?? null;

  // `?code=` opens the card; closing it clears the param.
  useEffect(() => {
    if (!params.code) setCardTarget((current) => (current ? null : current));
    else setCardTarget((current) => (current?.code === params.code ? current : { code: params.code }));
  }, [params.code]);

  const closeCard = useCallback(() => {
    setCardTarget(null);
    setParams({ code: "", tab: "" });
  }, [setParams]);
  const reloadSheet = useCallback(() => setRefreshKey((k) => k + 1), []);

  const typicalNights = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of context.data?.series ?? []) if (s.default_nights != null) out.set(s.id, s.default_nights);
    return out;
  }, [context.data]);
  const periods = context.data?.periods ?? [];

  return (
    <div className="min-w-0 space-y-2">
      <PageHeader
        title="Departures"
        description="Every date of the organized tours, tour by tour, like a spreadsheet. Departures shows what the site shows on each date - season, status, labels, price, discount and gift; Prices the six room prices; Details the rest. Edit cells, paste from Excel or set many rows at once - the changes are marked until you click Save. A code opens the date's card."
        actions={
          <>
            <PublishSiteButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="More actions">
                  <MoreHorizontal />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/tours/series">
                    <Copy />
                    Series
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/tours/departures?board=classic" title="Vacation packages, deleted dates, Export to Excel">
                    <LayoutList />
                    Classic board
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setDialogOpen(true)} disabled={!context.data}>
              <PlusCircle />
              Add Departure
            </Button>
          </>
        }
      />

      <PricingSheet
        key={`${focusTour ?? "all"}:${params.series}`}
        defaultView={view}
        focusTour={focusTour}
        refreshKey={refreshKey}
        filters={{ season: params.season, status: params.status, q: params.q || params.series }}
        onOpenCard={(row, cardTab) => {
          setCardTarget({ id: row.id, code: row.code });
          setParams({ code: row.code, tab: cardTab ?? "" });
        }}
      />

      <DepartureCard
        target={cardTarget}
        tab={tab}
        onTabChange={(next) => setParams({ tab: next === "general" ? "" : next })}
        periods={periods}
        onClose={closeCard}
        onChanged={reloadSheet}
      />

      {context.data && (
        <NewDepartureDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          series={context.data.series}
          packages={context.data.packages}
          periods={periods}
          typicalNights={typicalNights}
          defaultSeriesId={context.data.series.find((s) => s.code === params.series || s.package_id === focusTour)?.id}
          onCreated={(created) => {
            setCardTarget({ id: created.id, code: created.code });
            setParams({ code: created.code, tab: "" });
            void afterUrlWrite().then(reloadSheet);
          }}
        />
      )}
    </div>
  );
}
