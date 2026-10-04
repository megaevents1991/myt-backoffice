"use client";

/**
 * "Ready for the site" of one tour: what the site needs before the tour sells,
 * worked out from what the tour page already loaded (its saved form, its
 * itinerary, its dates) - no request of its own. Each step opens the tab that
 * fixes it.
 */
import { CheckCircle2, Circle, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { todayIso } from "@/lib/tours/format";
import { doublePricePerPerson } from "@/components/tours/departures/departure-utils";
import type { TourDatesData } from "@/components/tours/departures/types";
import type {
  ItineraryVariant,
  PackageForm,
  ReadinessState,
  SitePublishRecord,
  TermOption,
  TourReadinessItem,
} from "@/components/tours/content/shared";

const hasText = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;

export function tourReadiness(input: {
  form: PackageForm;
  itineraries: ItineraryVariant[];
  terms: TermOption[];
  dates: TourDatesData | null;
  updatedAt: string | null;
  lastPublish: SitePublishRecord | null;
}): TourReadinessItem[] {
  const { form, dates } = input;
  const today = todayIso();
  const upcoming = (dates?.rows ?? []).filter((r) => r.start_date >= today && !r.is_deleted);
  const noPrice = upcoming.filter((r) => doublePricePerPerson(r).price == null).length;
  const noFlight = upcoming.filter((r) => r.stats.liveBlocks === 0).length;
  const noSeason = upcoming.filter((r) => !r.season_id).length;
  const published = upcoming.filter((r) => r.is_published).length;
  const mainDays = input.itineraries.find((v) => v.key === "main")?.days.length ?? 0;
  const chosen = new Set(form.termIds);
  const audiences = input.terms.filter((t) => t.kind === "audiences" && chosen.has(t.id)).length;
  // The tour row and its dates carry the time of their last change; prices, flights and itinerary
  // edits do not, so after those the operator publishes again on their own (the detail says so).
  const publishedAfterChange =
    !!input.lastPublish?.ok &&
    !!input.updatedAt &&
    Date.parse(input.lastPublish.at) > Date.parse(input.updatedAt);

  const item = (key: string, label: string, state: ReadinessState, detail: string, tab: string): TourReadinessItem => ({
    key,
    label,
    state,
    detail,
    tab,
  });
  const loading = dates === null;
  return [
    item(
      "details",
      "Details",
      form.name && form.slug && form.days && form.nights ? "done" : "todo",
      "Name, address, days and nights",
      "general",
    ),
    item("images", "Images", form.heroImage && form.cardImage ? "done" : "todo", "Top image and card image", "images"),
    item("description", "Description", hasText(form.descriptionHtml) ? "done" : "todo", "The text about the tour", "description"),
    item("itinerary", "Itinerary", mainDays > 0 ? "done" : "todo", mainDays ? `${mainDays} days` : "The day-by-day plan", "itinerary"),
    item(
      "categories",
      "Categories",
      audiences > 0 ? "done" : "warn",
      audiences > 0 ? "Listed under its audience" : "No audience: the homepage tabs will not show it",
      "terms",
    ),
    item(
      "dates",
      "Dates",
      loading ? "todo" : upcoming.length > 0 ? "done" : "todo",
      upcoming.length ? `${upcoming.length} upcoming` : "No upcoming dates",
      "dates",
    ),
    item(
      "seasons",
      "Seasons",
      upcoming.length === 0 ? "todo" : noSeason === 0 ? "done" : "warn",
      noSeason
        ? `${noSeason} upcoming dates with no season - assign them before they go on the site`
        : upcoming.length
          ? "Every date belongs to a season"
          : "Add dates first",
      "seasons",
    ),
    item(
      "prices",
      "Prices",
      upcoming.length > 0 && noPrice === 0 ? "done" : "todo",
      noPrice ? `${noPrice} dates without a double-room price` : upcoming.length ? "Every date has a price" : "Add dates first",
      "dates",
    ),
    item(
      "flights",
      "Flights",
      upcoming.length > 0 && noFlight === 0 ? "done" : "warn",
      noFlight
        ? `${noFlight} dates without a live flight block - they can be sold; the site says the flight details will follow`
        : upcoming.length
          ? "Every date has a flight"
          : "Add dates first",
      "dates",
    ),
    item(
      "published",
      "On sale",
      published > 0 ? "done" : "todo",
      published ? `${published} dates on the site` : "No date is published yet",
      "dates",
    ),
    item("active", "Active", form.isActive ? "done" : "todo", form.isActive ? "The tour is active" : "Switch the tour on", "general"),
    item(
      "site",
      "Revalidate",
      publishedAfterChange ? "done" : "todo",
      publishedAfterChange
        ? "Rebuilt after the last change of the tour or its dates. After editing prices, flights or the itinerary, revalidate again."
        : "Rebuild the site to show the changes",
      "general",
    ),
  ];
}

const ICONS: Record<ReadinessState, typeof Circle> = { done: CheckCircle2, todo: Circle, warn: AlertTriangle };
const TONES: Record<ReadinessState, string> = {
  done: "border-success/30 bg-success-muted text-success",
  todo: "border-border bg-background text-muted-foreground",
  warn: "border-warning/40 bg-warning-muted text-warning",
};

export function TourReadinessStrip({ items, onOpen }: { items: TourReadinessItem[]; onOpen: (tab: string) => void }) {
  const done = items.filter((i) => i.state === "done").length;
  const ready = items.every((i) => i.state !== "todo");
  return (
    <section aria-label="Ready for the site" className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Ready for the site</span>
        <span className={cn("text-xs", ready ? "text-success" : "text-muted-foreground")}>
          {ready ? "Ready - every step is done" : `${done} of ${items.length} done`}
        </span>
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {items.map((i) => {
          const Icon = ICONS[i.state];
          return (
            <li key={i.key}>
              <button
                type="button"
                title={i.detail}
                onClick={() => i.tab && onOpen(i.tab)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:border-foreground/30",
                  TONES[i.state],
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {i.label}
                <span className="sr-only">: {i.detail}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
