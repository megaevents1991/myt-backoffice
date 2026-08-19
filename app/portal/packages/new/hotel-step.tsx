"use client";

/**
 * Hotel step - myt-main's HotelSelection, agent-side.
 * Same anatomy: band with guests + dates search, the 3-tab sort row
 * (price/stars/distance), a filters sidebar (breakfast / stars / name), and one
 * merged card list - offline rooms first (badged "מהמלאי המובטח", with per-room
 * unit counters, since that inventory is sold by room), then live Ratehawk
 * results styled like main's hotelCard: photo, name + stars, distance line,
 * room + breakfast, and a per-guest price delta.
 */

import { useMemo, useState } from "react";
import {
  BedDouble,
  CalendarCheck,
  CalendarX2,
  DollarSign,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Utensils,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BuilderHotelRoom, LiveHotelOption } from "@/lib/actions/portal-package-actions";
import { useWizard } from "./wizard-context";
import {
  CardWrapper,
  DashedOptionRow,
  deltaVsBase,
  DeltaPrice,
  EventBand,
  IssueState,
  MobileDeltaPill,
  PromotedPill,
  SortTabs,
  usd,
  type SortTabOption,
} from "./wizard-ui";

type HsSort = "price" | "stars" | "distance";

const hasMeal = (meal: string | null | undefined) => !!meal && meal !== "nomeal";

/**
 * Agent-only cancellation banner (main's customer cards don't show it) - the
 * one term an agent must know before pinning a hotel into a package.
 */
function CancellationBadge({ freeUntil }: { freeUntil: string | null }) {
  if (!freeUntil) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <CalendarX2 className="h-3 w-3" /> ללא ביטול חינם
      </span>
    );
  }
  const d = new Date(freeUntil);
  const label = Number.isNaN(d.getTime())
    ? freeUntil
    : d.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
      <CalendarCheck className="h-3 w-3" /> ביטול חינם עד {label}
    </span>
  );
}

function StarsRow({ rating }: { rating: number }) {
  if (!rating || rating <= 0) return null;
  return (
    <span className="flex items-center gap-[2px]">
      {Array.from({ length: Math.min(5, Math.round(rating)) }, (_, i) => (
        <Star
          key={i}
          size={16}
          fill="currentColor"
          className="text-brand-forest dark:text-foreground"
        />
      ))}
    </span>
  );
}

type DisplayHotel =
  | { kind: "offline"; key: string; group: BuilderHotelRoom[]; perPerson: number; stars: number }
  | { kind: "live"; key: string; option: LiveHotelOption; perPerson: number; stars: number };

export function HotelStep() {
  const w = useWizard();
  const [sort, setSort] = useState<HsSort>("price");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [breakfastOnly, setBreakfastOnly] = useState(false);
  const [minStars, setMinStars] = useState(0);
  const [nameQuery, setNameQuery] = useState("");
  // The full offer is ~800 rate cards for a big city - render incrementally so
  // the DOM stays light; sorting/filtering still runs over the whole list.
  const [visibleCount, setVisibleCount] = useState(80);

  const { event } = w;

  const hotelGroups = useMemo(() => {
    const groups = new Map<string, BuilderHotelRoom[]>();
    for (const room of w.hotels) {
      const key = `${room.hid ?? room.hotel_name}|${room.check_in}|${room.check_out}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(room);
    }
    return [...groups.entries()];
  }, [w.hotels]);

  const list = useMemo<DisplayHotel[]>(() => {
    const term = nameQuery.trim().toLowerCase();
    const offline: DisplayHotel[] = hotelGroups
      .map(([key, group]) => {
        const rooms = breakfastOnly ? group.filter((r) => hasMeal(r.meal_plan)) : group;
        const cheapestPerPerson = rooms.length
          ? Math.min(...rooms.map((r) => r.price / Math.max(1, r.capacity)))
          : Infinity;
        return {
          kind: "offline" as const,
          key,
          group: rooms,
          perPerson: cheapestPerPerson,
          stars: group[0]?.stars ?? 0,
        };
      })
      .filter(
        (h) =>
          h.group.length > 0 &&
          h.stars >= minStars &&
          (!term || h.group[0].hotel_name.toLowerCase().includes(term)),
      );
    const live: DisplayHotel[] = (w.hsResults ?? [])
      .filter(
        (o) =>
          (!breakfastOnly || hasMeal(o.meal)) &&
          o.stars >= minStars &&
          (!term || o.name.toLowerCase().includes(term)),
      )
      .map((o) => ({
        kind: "live" as const,
        key: o.key,
        option: o,
        perPerson: o.price / Math.max(1, w.qty),
        stars: o.stars,
      }));
    const merged = [...offline, ...live];
    if (sort === "stars") {
      return merged.sort((a, b) => b.stars - a.stars || a.perPerson - b.perPerson);
    }
    if (sort === "distance") {
      const dist = (h: DisplayHotel) =>
        h.kind === "live" && h.option.distance_m > 0 ? h.option.distance_m : 0;
      return merged.sort((a, b) => dist(a) - dist(b) || a.perPerson - b.perPerson);
    }
    return merged.sort((a, b) => a.perPerson - b.perPerson);
  }, [hotelGroups, w.hsResults, w.qty, breakfastOnly, minStars, nameQuery, sort]);

  if (!event) return null;

  const sortOptions: SortTabOption<HsSort>[] = [
    { key: "price", title: "הזול ביותר", subtitle: "המחיר הנמוך ביותר", icon: DollarSign },
    { key: "stars", title: "כוכבים", subtitle: "הדירוג הגבוה ביותר", icon: Star },
    { key: "distance", title: "הקרוב ביותר", subtitle: "הקרוב לאירוע", icon: MapPin },
  ];

  return (
    <section className="space-y-2 lg:space-y-4">
      <EventBand
        name={event.name}
        date={event.date}
        location={event.location_name}
        imageUrl={event.image_url}
      >
        {/* One compact search pill - matches the flight step's, never wraps
            into a second row on desktop. */}
        <div className="flex w-full items-center lg:w-auto lg:flex-1 lg:justify-end">
          <div className="flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-sm lg:w-auto lg:flex-nowrap">
            <span className="flex h-9 shrink-0 items-center gap-1.5 ps-1.5 pe-2 text-sm text-muted-foreground">
              אורחים
              <span className="text-base font-semibold text-foreground">{w.qty}</span>
            </span>
            <span className="hidden h-6 w-px shrink-0 bg-border lg:block" />
            <Input
              type="date"
              dir="ltr"
              aria-label="צ'ק-אין"
              value={w.hsCheckin}
              onChange={(e) => w.setHsCheckin(e.target.value)}
              onFocus={() => {
                if (!w.hsCheckin && !w.hsCheckout) {
                  const d = w.defaultHotelDates();
                  w.setHsCheckin(d.checkin);
                  w.setHsCheckout(d.checkout);
                }
              }}
              className="h-9 w-[8.4rem] shrink-0 border-0 bg-background shadow-none"
            />
            <span className="shrink-0 text-muted-foreground">-</span>
            <Input
              type="date"
              dir="ltr"
              aria-label="צ'ק-אאוט"
              value={w.hsCheckout}
              onChange={(e) => w.setHsCheckout(e.target.value)}
              className="h-9 w-[8.4rem] shrink-0 border-0 bg-background shadow-none"
            />
            <button
              type="button"
              onClick={() => {
                if (!w.hsCheckin || !w.hsCheckout) {
                  const d = w.defaultHotelDates();
                  w.setHsCheckin(d.checkin);
                  w.setHsCheckout(d.checkout);
                  if (!d.checkin || !d.checkout) return;
                }
                w.runHotelSearch();
              }}
              disabled={w.hsLoading}
              aria-label="חיפוש מלונות"
              className="flex h-9 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-forest text-white transition-opacity disabled:opacity-50 dark:bg-brand-mint dark:text-brand-forest"
            >
              {w.hsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search size={18} />}
            </button>
          </div>
        </div>
      </EventBand>

      {/* Mobile: filter toggle beside the sort pills, like main's hotel step */}
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          aria-label="סינון"
          onClick={() => setFiltersOpen((v) => !v)}
          className={cn(
            "flex w-[38px] flex-shrink-0 items-center justify-center rounded-md border bg-card transition-colors lg:hidden",
            filtersOpen ? "border-brand-forest" : "border-border hover:border-brand-forest",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <SortTabs options={sortOptions} active={sort} onChange={setSort} />
        </div>
      </div>

      {w.hsError && <p className="text-sm text-destructive">{w.hsError}</p>}

      <div className="flex w-full flex-col items-start gap-2 lg:flex-row lg:gap-4">
        {/* Filters sidebar */}
        <div
          className={cn(
            "w-full space-y-4 rounded-lg border-2 border-border p-4 shadow-lg lg:sticky lg:top-0 lg:w-1/4",
            !filtersOpen && "hidden lg:block",
          )}
          dir="rtl"
        >
          <div className="px-1">
            <h3 className="mb-2 text-lg font-semibold">ארוחות בוקר</h3>
            <label htmlFor="hf-breakfast" className="flex cursor-pointer items-center gap-2 py-1 text-sm">
              <Checkbox
                id="hf-breakfast"
                checked={breakfastOnly}
                onCheckedChange={(v) => setBreakfastOnly(v === true)}
              />
              <span className="flex items-center gap-1.5">
                <Utensils className="h-4 w-4" /> כולל ארוחת בוקר
              </span>
            </label>
          </div>
          <div className="px-1">
            <h3 className="mb-2 text-lg font-semibold">דירוג כוכבים</h3>
            <div className="flex flex-wrap gap-2">
              {[0, 3, 4, 5].map((stars) => (
                <button
                  key={stars}
                  type="button"
                  onClick={() => setMinStars(stars)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    minStars === stars
                      ? "border-transparent bg-brand-forest text-white dark:bg-brand-mint dark:text-brand-forest"
                      : "bg-card hover:bg-muted",
                  )}
                >
                  {stars === 0 ? (
                    "הכל"
                  ) : (
                    <>
                      {stars}
                      <Star size={12} fill="currentColor" /> ומעלה
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="px-1">
            <h3 className="mb-2 text-lg font-semibold">חיפוש מלון</h3>
            <div className="relative">
              <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="חפש מלון..."
                className="pe-9"
              />
            </div>
            {/* The loaded list is a capped slice of the live offer. When the
                typed name isn't in it, offer a server-side dig through the FULL
                serp result - the same pool main shows the customer. */}
            {(() => {
              const term = nameQuery.trim().toLowerCase();
              const missesLoaded =
                term.length >= 2 &&
                w.hsResults != null &&
                !(w.hsResults ?? []).some((o) =>
                  o.name.toLowerCase().includes(term),
                );
              if (!missesLoaded) return null;
              return (
                <button
                  type="button"
                  disabled={w.hsLoading}
                  onClick={() => {
                    if (!w.hsCheckin || !w.hsCheckout) {
                      const d = w.defaultHotelDates();
                      w.setHsCheckin(d.checkin);
                      w.setHsCheckout(d.checkout);
                      if (!d.checkin || !d.checkout) return;
                    }
                    w.runHotelSearch({ query: nameQuery.trim() });
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-forest px-3 py-2 text-sm font-medium text-brand-forest transition-colors hover:bg-brand-mint/10 disabled:opacity-50 dark:border-brand-mint dark:text-brand-mint"
                >
                  {w.hsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  חפשו &quot;{nameQuery.trim()}&quot; בכל ההיצע
                </button>
              );
            })()}
          </div>
        </div>

        {/* Cards */}
        <div className="w-full lg:w-3/4">
          {w.inventoryLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" /> טוען מלונות...
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 py-2 lg:gap-4 lg:py-0">
              {list.slice(0, visibleCount).map((h) =>
                h.kind === "offline" ? (
                  <OfflineHotelCard key={h.key} groupKey={h.key} group={h.group} />
                ) : (
                  <LiveHotelCard key={h.key} option={h.option} perPerson={h.perPerson} />
                ),
              )}

              {list.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((v) => v + 80)}
                  className="w-full rounded-lg border-2 border-dashed border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-brand-forest hover:text-foreground dark:hover:border-brand-mint"
                >
                  הצג עוד מלונות ({list.length - visibleCount} אופציות נוספות)
                </button>
              )}

              {list.length === 0 && (w.hotels.length > 0 || w.hsResults != null) && (
                <IssueState
                  title="לא מצאנו מלונות שמתאימים לחיפוש"
                  subtitle="נסו לנקות חלק מהסינון או לשנות תאריכים"
                />
              )}
              {w.hotels.length === 0 && w.hsResults == null && (
                <IssueState
                  title="חפשו מלונות לתאריכים שלכם"
                  subtitle="בחרו תאריכים למעלה ולחצו חיפוש - ההיצע החי סביב האירוע, בדיוק כמו באתר"
                />
              )}

              <div className="space-y-2 pt-2">
                <DashedOptionRow
                  icon={BedDouble}
                  title="הלקוח יבחר מלון באתר"
                  subtitle="הלינק יפתח את שלב המלונות עם ההיצע החי סביב האירוע"
                  selected={w.hotelChoice.mode === "live" && !!w.hotelChoice.explicit}
                  onClick={() => w.setHotelChoice({ mode: "live", explicit: true })}
                />
                <DashedOptionRow
                  icon={BedDouble}
                  title="חבילה ללא מלון"
                  subtitle="הלקוח מסדר לינה לבד"
                  selected={w.hotelChoice.mode === "none"}
                  onClick={() => w.setHotelChoice({ mode: "none" })}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Offline inventory - sold by room, so the card keeps per-room unit counters. */
function OfflineHotelCard({ groupKey, group }: { groupKey: string; group: BuilderHotelRoom[] }) {
  const w = useWizard();
  const anchor = group[0];
  const activeRow = w.hotels.find((room) => (w.selectedUnits[room.rowId] ?? 0) > 0);
  const selectedGroupKey = activeRow
    ? `${activeRow.hid ?? activeRow.hotel_name}|${activeRow.check_in}|${activeRow.check_out}`
    : null;
  const isSelected = selectedGroupKey === groupKey;
  const otherGroupSelected = selectedGroupKey !== null && !isSelected;
  const { event } = w;
  const cheapestPerPerson = Math.min(...group.map((r) => r.price / Math.max(1, r.capacity)));
  const delta = deltaVsBase(cheapestPerPerson, event?.base_hotel_price);

  return (
    <div className="relative">
      <MobileDeltaPill delta={delta} per="אורח" selected={isSelected} />
      <div
        dir="rtl"
        className={cn(
          "relative rounded-lg border-2 border-border bg-card p-4 pt-5 shadow-lg transition-shadow lg:pt-4",
          isSelected && "border-brand-forest bg-brand-mint/10 dark:border-brand-mint",
          otherGroupSelected && "opacity-50",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BedDouble className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-lg font-bold lg:text-2xl">{anchor.hotel_name}</span>
            <StarsRow rating={anchor.stars} />
          </div>
          <div className="flex items-center gap-3">
            <PromotedPill />
            <span className="text-xs text-muted-foreground" dir="ltr">
              {anchor.check_in} → {anchor.check_out}
            </span>
          </div>
        </div>
        <div className="mt-1 hidden lg:block">
          <DeltaPrice delta={delta} per="אורח" className="!flex-row items-baseline gap-2 text-brand-forest dark:text-brand-mint" />
        </div>
        <ul className="mt-3 space-y-2">
          {group.map((room) => {
            const count = w.selectedUnits[room.rowId] ?? 0;
            return (
              <li
                key={room.rowId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span dir="ltr" className="font-bold">{room.room_type}</span>
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      עד {room.capacity} נוסעים · נותרו {room.remaining}
                    </span>
                    {hasMeal(room.meal_plan) && (
                      <span className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Utensils className="h-3.5 w-3.5" /> כולל ארוחת בוקר
                      </span>
                    )}
                    {room.last_cancellation_date && (
                      <span className="ms-2 inline-flex align-middle">
                        <CancellationBadge freeUntil={room.last_cancellation_date} />
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">
                    {usd(room.price)}
                    <span className="ms-1 text-xs font-normal text-muted-foreground">לחדר לכל השהות</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="פחות חדרים"
                      disabled={count === 0 || otherGroupSelected}
                      onClick={() => w.setUnitCount(room, -1)}
                      className="rounded-full border border-border bg-background p-1 transition-colors hover:border-brand-forest disabled:opacity-40 dark:hover:border-brand-mint"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{count}</span>
                    <button
                      type="button"
                      aria-label="עוד חדרים"
                      disabled={count >= room.remaining || otherGroupSelected}
                      onClick={() => w.setUnitCount(room, 1)}
                      className="rounded-full border border-border bg-background p-1 transition-colors hover:border-brand-forest disabled:opacity-40 dark:hover:border-brand-mint"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {isSelected && w.hotelCapacity < w.qty && (
          <p className="mt-2 text-sm text-destructive">
            החדרים שנבחרו מתאימים ל-{w.hotelCapacity} נוסעים, אבל בחבילה {w.qty} - הוסיפו חדר.
          </p>
        )}
      </div>
    </div>
  );
}

/** Live Ratehawk result - main's hotelCard layout. */
function LiveHotelCard({ option, perPerson }: { option: LiveHotelOption; perPerson: number }) {
  const w = useWizard();
  const isSelected =
    w.hotelChoice.mode === "live-offer" && w.hotelChoice.option.key === option.key;
  const delta = deltaVsBase(perPerson, w.event?.base_hotel_price);

  return (
    <div className="relative">
      <MobileDeltaPill delta={delta} per="אורח" selected={isSelected} />
      <CardWrapper
        isSelected={isSelected}
        onClick={() => w.setHotelChoice({ mode: "live-offer", option })}
        className="pt-4 lg:pt-2"
      >
        <div className="flex w-full flex-col gap-2 py-1 lg:flex-row lg:items-center">
          <div className="flex w-full min-w-0 flex-col gap-2 lg:w-4/5 lg:flex-row lg:items-center">
            {option.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={option.image}
                alt={option.name}
                className="h-[180px] w-full shrink-0 rounded-lg border object-cover lg:h-[150px] lg:w-[240px]"
              />
            ) : (
              <div className="flex h-[180px] w-full shrink-0 items-center justify-center rounded-lg bg-muted lg:h-[150px] lg:w-[240px]">
                <BedDouble className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex w-full flex-row flex-wrap items-center gap-2">
                <span className="text-lg font-bold lg:text-2xl">{option.name}</span>
                <StarsRow rating={option.stars} />
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-[14px]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {option.distance_m > 0
                  ? `${(option.distance_m / 1000).toFixed(1)} ק"מ מהאירוע`
                  : option.address}
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm">
                <span className="font-bold" dir="ltr">
                  {option.room_name}
                </span>
                {hasMeal(option.meal) && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Utensils size={16} /> כולל ארוחת בוקר
                  </span>
                )}
              </p>
              <p className="mt-1.5">
                <CancellationBadge freeUntil={option.free_cancellation_before} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {`סה"כ ${usd(option.price)} לכל השהות`}
              </p>
            </div>
          </div>
          <div className="hidden items-center justify-center border-r border-border pr-2 lg:flex lg:w-1/5">
            <DeltaPrice delta={delta} per="אורח" />
          </div>
        </div>
      </CardWrapper>
    </div>
  );
}
