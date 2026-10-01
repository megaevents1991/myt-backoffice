/**
 * Shapes that travel between the series server actions and the series screen.
 * (A "use server" module may only export async functions.)
 */
import type { BoardPackage, BoardPeriod, BoardSeries } from "@/components/tours/departures/types";

export const SERIES_TERM_KINDS = ["audiences", "tags", "destinations"] as const;
export type SeriesTermKind = (typeof SERIES_TERM_KINDS)[number];

export const SERIES_TERM_KIND_LABELS: Record<SeriesTermKind, string> = {
  audiences: "קהל",
  tags: "תגיות",
  destinations: "יעדים",
};

export interface SeriesTerm {
  id: string;
  kind: SeriesTermKind;
  name: string;
}

export interface SeriesListRow extends BoardSeries {
  termIds: string[];
  /** Departures that are not deleted. */
  departures: number;
  /** Of those, the ones that have not ended yet. */
  upcoming: number;
}

export interface SeriesScreenData {
  series: SeriesListRow[];
  packages: BoardPackage[];
  terms: SeriesTerm[];
  periods: BoardPeriod[];
}

export interface SeriesInput {
  code: string;
  label: string | null;
  package_id: string | null;
  arrival_airport: string | null;
  arrival_weekday: number | null;
  return_airport: string | null;
  return_weekday: number | null;
  default_nights: number | null;
  default_capacity: number | null;
  default_currency: string;
  child_max_age: number;
  senior_min_age: number | null;
  senior_discount: number | null;
  is_active: boolean;
  termIds: string[];
}

/** An existing departure of the series - what a proposed date is checked against, and a possible copy source. */
export interface SeasonExistingDeparture {
  id: string;
  code: string;
  season_year: number;
  start_date: string;
  end_date: string;
  currency: string;
  season: string | null;
  is_deleted: string | null;
  priceRows: number;
  optionRows: number;
  activePromotions: number;
}

export interface SeasonContext {
  /** Every departure of the company that shares a code prefix with the series - codes are unique per company and year. */
  existing: SeasonExistingDeparture[];
  /** `${code}:${season_year}` of every departure of the company whose code starts with the series code. */
  takenCodes: string[];
}

export interface SeasonCreateInput {
  seriesId: string;
  items: { start_date: string; end_date: string }[];
  season: string | null;
  copyFromDepartureId: string | null;
  copyPrices: boolean;
  copyPromotions: boolean;
}

export interface SeasonCreateResult {
  created: { id: string; code: string; start_date: string }[];
  skipped: { code: string; reason: string }[];
}
