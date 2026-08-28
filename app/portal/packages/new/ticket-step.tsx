"use client";

/**
 * Tickets step - myt-main's TicketSelection, agent-side.
 * Layout: `lg:flex-row-reverse` under dir=rtl ⇒ venue map LEFT (45%), category
 * list RIGHT (55%) on desktop; map first when stacked on mobile - like main.
 * Category rows mirror EventTicketCard: accent strip, radio, big category name,
 * delta column ("כלול במחיר" for the cheapest), qty counter inside the selected
 * row ("אנחנו רוצים / כרטיסים לאירוע").
 */

import { Loader2, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TixstockDynamicMap } from "@/components/TixstockDynamicMap";
import { eventTicketToListing, type TixStockMatchableListing } from "@/lib/tixstock-map";
import { useWizard } from "./wizard-context";
import { CardWrapper, deltaVsBase, DeltaPrice, EventBand } from "./wizard-ui";

function QtyCounter({ className }: { className?: string }) {
  const { qty, setQty } = useWizard();
  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      <span className="text-sm">אנחנו רוצים</span>
      <button
        type="button"
        aria-label="פחות כרטיסים"
        disabled={qty <= 1}
        onClick={(e) => {
          e.stopPropagation();
          setQty(Math.max(1, qty - 1));
        }}
        className="rounded-full border border-border bg-background p-1 transition-colors hover:border-brand-forest disabled:opacity-40 dark:hover:border-brand-mint"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-8 text-center text-xl font-bold tabular-nums">{qty}</span>
      <button
        type="button"
        aria-label="עוד כרטיסים"
        disabled={qty >= 20}
        onClick={(e) => {
          e.stopPropagation();
          setQty(Math.min(20, qty + 1));
        }}
        className="rounded-full border border-border bg-background p-1 transition-colors hover:border-brand-forest disabled:opacity-40 dark:hover:border-brand-mint"
      >
        <Plus className="h-4 w-4" />
      </button>
      <span className="text-sm">כרטיסים לאירוע</span>
    </div>
  );
}

export function TicketStep() {
  const w = useWizard();
  const { event } = w;
  if (!event) return null;

  // Cheapest-first, like main's ticket list.
  const sorted = [...w.activeTickets].sort(
    (a, b) => (a.site_price ?? a.price) - (b.site_price ?? b.price),
  );
  const cheapestSite = sorted[0]?.site_price ?? null;

  // The map needs TixStock-shaped listings. Before live listings land (or if
  // they fail), fall back to the catalog categories - category-only matching
  // still paints and matches sections, exactly like main pre-hydration.
  const mapListings: TixStockMatchableListing[] =
    w.tixListings.length > 0
      ? w.tixListings
      : w.activeTickets.map((t) =>
          eventTicketToListing({
            id: t.id,
            category: t.category,
            description: "",
            price: t.price,
          }),
        );

  const cheapestListingOf = (cat: string | null): TixStockMatchableListing | null => {
    if (!cat) return null;
    const norm = cat.trim().toLowerCase();
    const inCat = mapListings.filter(
      (l) => l.seat_details?.category?.trim().toLowerCase() === norm,
    );
    if (inCat.length === 0) return null;
    return inCat.reduce((min, l) =>
      (l.proceed_price ?? Infinity) < (min.proceed_price ?? Infinity) ? l : min,
    );
  };

  const onMapSelect = (ticketId: string) => {
    const listing = mapListings.find((l) => l.id === ticketId);
    const cat = listing?.seat_details?.category?.trim().toLowerCase();
    if (!cat) return;
    const match = w.activeTickets.find((t) => t.category.trim().toLowerCase() === cat);
    if (match) w.setCategory(match.category);
  };

  const mapBlock = event.map_image_url ? (
    w.isTx ? (
      <TixstockDynamicMap
        mapUrl={event.map_image_url}
        tickets={mapListings}
        hoveredTicket={cheapestListingOf(w.hoveredCat)}
        selectedTicketId={cheapestListingOf(w.category)?.id ?? null}
        onTicketSelect={onMapSelect}
        excludedSections={event.tx_excluded_sections ?? undefined}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={event.map_image_url}
        alt={`מפת האולם - ${event.name}`}
        className="h-auto w-full rounded-lg object-contain max-h-[45svh] lg:max-h-[calc(100vh-10rem)]"
      />
    )
  ) : null;

  return (
    <section className="space-y-4">
      <EventBand
        name={event.name}
        date={event.date}
        location={event.location_name}
        imageUrl={event.image_url}
      />

      <div className="text-lg">
        בחרו כמות כרטיסים וקטגוריה מועדפת -{" "}
        <span className="font-bold">כך בדיוק זה נראה ללקוח באתר.</span>
      </div>
      {/* V2 spec: seating commitment shown on the ticket step. */}
      <p className="text-sm text-muted-foreground">
        אנחנו מתחייבים לישיבה צמודה בזוגות ובשלשות.
      </p>

      {w.isTx && w.tixLoading && (
        <div className="flex items-center gap-3 p-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          טוען מחירים עדכניים ל-{w.qty} כרטיסים...
        </div>
      )}
      {w.isTx && w.tixError && (
        <p className="text-sm text-destructive">
          {w.tixError}{" "}
          <span className="text-muted-foreground">(מוצגים מחירי הבוקר מהמערכת)</span>
        </p>
      )}

      <div className="mt-2 flex flex-col gap-4 lg:flex-row-reverse">
        {/* Map - left on desktop, top on mobile (main's split) */}
        {mapBlock && (
          <>
            <div className="w-full lg:hidden">{mapBlock}</div>
            <div className="hidden lg:block lg:w-[45%]">{mapBlock}</div>
          </>
        )}

        {/* Category list */}
        <div className={cn("w-full", mapBlock && "lg:w-[55%]")}>
          <div
            className="flex flex-col gap-2 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pe-1"
            role="group"
            aria-label="בחירת קטגוריה"
          >
            {sorted.map((t) => {
              const isSelected = w.category === t.category;
              const delta =
                t.site_price != null && cheapestSite != null
                  ? deltaVsBase(t.site_price, cheapestSite)
                  : null;
              return (
                <CardWrapper
                  key={t.category}
                  isSelected={isSelected}
                  onClick={() => w.setCategory(t.category)}
                  className="flex-col overflow-visible p-2 pr-8"
                >
                  <div
                    className="flex w-full items-center justify-between"
                    onMouseEnter={() => w.setHoveredCat(t.category)}
                    onMouseLeave={() =>
                      w.setHoveredCat(w.hoveredCat === t.category ? null : w.hoveredCat)
                    }
                  >
                    {/* Accent strip on the card's right edge, like main */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute bottom-0 right-0 top-0 w-[20px] rounded-r-md transition-colors",
                        isSelected ? "bg-brand-forest dark:bg-brand-mint" : "bg-brand-mint",
                      )}
                    />
                    <div className="flex min-w-0 items-center gap-4 lg:w-3/5">
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                          isSelected ? "border-brand-forest dark:border-brand-mint" : "border-border",
                        )}
                      >
                        {isSelected && (
                          <span className="h-2.5 w-2.5 rounded-full bg-brand-forest dark:bg-brand-mint" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-xl font-bold">
                          <span className="truncate">{t.category}</span>
                          {w.isTx && w.liveTix && (
                            <Badge variant="secondary" className="shrink-0 font-normal">
                              מחיר חי
                            </Badge>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="w-1/3 text-center font-bold lg:w-1/4">
                      {delta ? (
                        delta.kind === "included" ? (
                          <span className="text-[20px]">כלול במחיר</span>
                        ) : (
                          <DeltaPrice delta={delta} per="כרטיס" />
                        )
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </div>
                    {/* Desktop qty counter inside the selected row */}
                    <div
                      className="hidden lg:block lg:w-1/3"
                      style={{ visibility: isSelected ? "visible" : "hidden" }}
                    >
                      <QtyCounter />
                    </div>
                  </div>
                  {/* Mobile qty counter under the selected row */}
                  {isSelected && (
                    <div className="mt-2 block w-full border-t-2 border-border pt-2 lg:hidden">
                      <QtyCounter />
                    </div>
                  )}
                </CardWrapper>
              );
            })}
          </div>

          {w.isTx && w.liveTix && w.activeTickets.length === 0 && !w.tixLoading && (
            <p className="mt-3 text-sm text-muted-foreground">
              אין כרטיסים חיים שמספיקים ל-{w.qty} נוסעים - נסו כמות אחרת.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
