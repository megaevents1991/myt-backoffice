"use server";

/**
 * Tours > Departures and the tour page's sheet (mega-family
 * docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 4-6, and
 * docs/plans/TOUR-UPLOAD-ROUND9-PLAN.md): every sub-tour of the organized tours
 * as one spreadsheet, tour by tour - the departures, prices and details views
 * are column sets over the same rows.
 *
 * getPricingSheet reads the rows; savePricingSheet writes the changed cells of
 * many rows at once. A row is written only when every changed cell still holds
 * the value the sheet showed (`before`) - otherwise someone changed it in the
 * meantime and it is skipped with the reason. The writes go through the actions
 * the departure card uses (updateDeparture, saveDeparturePrices, savePromotion,
 * setDeparturesPublished), so a published sub-tour keeps what the site needs by
 * the same rules.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { flightsOf } from "@/lib/flights-scope";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, chunk, fetchAll, must, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { todayIso } from "@/lib/tours/format";
import { departureRouteLabel } from "@/lib/tours/routes";
import { promotionSummary, siteSaleStatus } from "@/components/tours/departures/departure-utils";
import type { DepartureGeneralInput } from "@/components/tours/departures/types";
import { BLOCK_STATUS_LABELS, LIVE_BLOCK_STATUSES, PRICE_MATRIX_ROWS, type BlockStatus, type PromotionKind } from "@/types/tours.types";
import {
  saveDeparturePrices,
  savePromotion,
  setDeparturesPublished,
  setPromotionActive,
  updateDeparture,
} from "@/lib/actions/tours-departure-actions";
import {
  cellValue,
  dateLabelsOf,
  discountText,
  EDITABLE_KEYS,
  isBarMitzvahLabel,
  MAX_DATE_LABELS,
  parseDiscount,
  priceIndexOf,
  sameValue,
  type PricingSheetData,
  type SheetFlight,
  type SheetRow,
  type SheetRowChange,
  type SheetSaveOutcome,
  type SheetTour,
  type SheetValue,
} from "@/components/tours/pricing/sheet-model";

const fail = (e: unknown) => actionFail(e, "tours-pricing-sheet-actions");

const MAX_ROWS_PER_SAVE = 1000;
const ID_CHUNK = 150;
const SHEET_SELECT =
  "id, code, package_id, series_id, start_date, end_date, season, season_id, itinerary_id, currency, is_published, sale_status, card_badge, arrival_airport, return_airport, capacity, date_labels, docket_no, meeting_at, transfers_included, child_max_age, senior_min_age, senior_discount, notes, origin_flight_id, departure_prices(pax_type, room_position, price), flight_allocations(flight_id, legs)";

interface RawRow {
  id: string;
  code: string;
  package_id: string;
  series_id: string;
  start_date: string;
  end_date: string;
  season: string | null;
  season_id: string | null;
  itinerary_id: string | null;
  currency: string;
  is_published: boolean;
  sale_status: string;
  card_badge: string | null;
  arrival_airport: string | null;
  return_airport: string | null;
  capacity: number | null;
  date_labels: string[] | null;
  docket_no: string | null;
  meeting_at: string | null;
  transfers_included: boolean;
  child_max_age: number | null;
  senior_min_age: number | null;
  senior_discount: number | null;
  notes: string | null;
  origin_flight_id: number | null;
  departure_prices: { pax_type: string; room_position: number; price: number }[];
  flight_allocations: { flight_id: number; legs: string }[];
}

interface PromoRow {
  id: string;
  departure_id: string | null;
  series_id: string | null;
  kind: string;
  value: number | null;
  label: string | null;
  valid_until: string | null;
  show_on_card: boolean;
}
const PROMO_SELECT = "id, departure_id, series_id, kind, value, label, valid_until, show_on_card";

interface FlightRow {
  id: number;
  cost_price: number | null;
  cost_currency: string | null;
  airline_code: string | null;
  block_status: string | null;
  is_deleted: boolean | null;
}

/** The sheet rows of some departures (not deleted), with seats, site status, flight and promotions. */
async function loadSheetRows(
  company: Company,
  filter: { packageIds?: string[]; ids?: string[]; from?: string | null },
): Promise<SheetRow[]> {
  const base = () => {
    let q = toursDb()
      .from("departures")
      .select(SHEET_SELECT)
      .eq("company_id", company.id)
      .eq("departure_prices.company_id", company.id)
      .eq("flight_allocations.company_id", company.id)
      .is("is_deleted", null);
    if (filter.from) q = q.gte("end_date", filter.from);
    return q;
  };
  let raw: RawRow[] = [];
  if (filter.ids) {
    for (const part of chunk(filter.ids, ID_CHUNK)) {
      raw = raw.concat((must(await base().in("id", part)) ?? []) as unknown as RawRow[]);
    }
  } else if (filter.packageIds) {
    for (const part of chunk(filter.packageIds, ID_CHUNK)) {
      raw = raw.concat(
        (await fetchAll((from, to) => base().in("package_id", part).order("start_date").order("id").range(from, to))) as unknown as RawRow[],
      );
    }
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));

  const ids = raw.map((d) => d.id);
  const seriesIds = [...new Set(raw.map((d) => d.series_id))];
  const seasonIds = [...new Set(raw.map((d) => d.season_id).filter((s): s is string => !!s))];
  const flightIds = [...new Set(raw.flatMap((d) => d.flight_allocations.map((a) => a.flight_id)))];
  const stats = new Map<string, { allocated: number; sold: number; remaining: number }>();
  const series = new Map<string, { code: string; arrival: string | null; ret: string | null }>();
  const seasons = new Map<string, string>();
  const flights = new Map<number, FlightRow>();
  const ownPromos = new Map<string, PromoRow[]>();
  const seriesPromos = new Map<string, PromoRow[]>();
  await Promise.all([
    (async () => {
      for (const part of chunk(ids, ID_CHUNK)) {
        const rows =
          must(
            await toursDb()
              .from("departure_stats")
              .select("departure_id, allocated_seats, sold, remaining")
              .eq("company_id", company.id)
              .in("departure_id", part),
          ) ?? [];
        for (const s of rows) {
          if (s.departure_id) {
            stats.set(s.departure_id, { allocated: s.allocated_seats ?? 0, sold: s.sold ?? 0, remaining: s.remaining ?? 0 });
          }
        }
      }
    })(),
    (async () => {
      for (const part of chunk(seriesIds, ID_CHUNK)) {
        const rows =
          must(await toursDb().from("series").select("id, code, arrival_airport, return_airport").eq("company_id", company.id).in("id", part)) ?? [];
        for (const s of rows) series.set(s.id, { code: s.code, arrival: s.arrival_airport, ret: s.return_airport });
      }
    })(),
    (async () => {
      for (const part of chunk(seasonIds, ID_CHUNK)) {
        const rows = must(await toursDb().from("package_seasons").select("id, name").eq("company_id", company.id).in("id", part)) ?? [];
        for (const s of rows) seasons.set(s.id, s.name);
      }
    })(),
    (async () => {
      for (const part of chunk(flightIds, ID_CHUNK)) {
        const { data, error } = await flightsOf(company)
          .select("id, cost_price, cost_currency, airline_code, block_status, is_deleted")
          .in("id", part);
        if (error) throw new Error(error.message);
        for (const f of (data ?? []) as unknown as FlightRow[]) flights.set(f.id, f);
      }
    })(),
    (async () => {
      for (const part of chunk(ids, ID_CHUNK)) {
        const rows =
          must(await toursDb().from("promotions").select(PROMO_SELECT).eq("company_id", company.id).eq("is_active", true).in("departure_id", part)) ?? [];
        for (const p of rows as PromoRow[]) {
          if (p.departure_id) ownPromos.set(p.departure_id, [...(ownPromos.get(p.departure_id) ?? []), p]);
        }
      }
    })(),
    (async () => {
      for (const part of chunk(seriesIds, ID_CHUNK)) {
        const rows =
          must(await toursDb().from("promotions").select(PROMO_SELECT).eq("company_id", company.id).eq("is_active", true).in("series_id", part)) ?? [];
        for (const p of rows as PromoRow[]) {
          if (p.series_id) seriesPromos.set(p.series_id, [...(seriesPromos.get(p.series_id) ?? []), p]);
        }
      }
    })(),
  ]);

  return raw.map((d): SheetRow => {
    const s = series.get(d.series_id);
    const seats = stats.get(d.id) ?? { allocated: 0, sold: 0, remaining: 0 };
    const prices = PRICE_MATRIX_ROWS.map((m) => {
      const cell = d.departure_prices.find((p) => p.pax_type === m.paxType && p.room_position === m.position);
      return cell ? Number(cell.price) : null;
    });
    // the block it was made from, else the first one flying out
    const blocks = [...new Set(d.flight_allocations.filter((a) => a.legs !== "inbound").map((a) => a.flight_id))];
    const main = d.origin_flight_id != null && blocks.includes(d.origin_flight_id) ? d.origin_flight_id : blocks[0];
    const cost = main != null ? flights.get(main) : undefined;
    const arrival = d.arrival_airport ?? s?.arrival ?? null;

    const linked = [...new Set(d.flight_allocations.map((a) => a.flight_id))]
      .map((id) => flights.get(id))
      .filter((f): f is FlightRow => !!f && f.is_deleted !== true);
    const isLive = (f: FlightRow) => LIVE_BLOCK_STATUSES.includes(f.block_status as BlockStatus);
    const live = linked.filter(isLive);
    const shown = live.length ? live : linked;
    const flight: SheetFlight | null = shown.length
      ? {
          airlines: [...new Set(shown.map((f) => f.airline_code).filter(Boolean))].join("+"),
          status: [...new Set(shown.map((f) => BLOCK_STATUS_LABELS[f.block_status as BlockStatus] ?? "Draft"))].join(", "),
          live: live.length > 0,
        }
      : null;

    const own = ownPromos.get(d.id) ?? [];
    // the Discount cell is the date's percent, else its amount per traveler (the two are either/or)
    const discount = own.find((p) => p.kind === "percent_order") ?? own.find((p) => p.kind === "fixed_per_pax");
    const gift = own.find((p) => p.kind === "gift");
    const special = own.find((p) => p.kind === "named_per_pax");
    const more = [
      ...own.filter((p) => p !== discount && p !== gift && p !== special).map((p) => promotionSummary({ ...p, is_active: true }, d.currency)),
      ...(seriesPromos.get(d.series_id) ?? []).map((p) => `${promotionSummary({ ...p, is_active: true }, d.currency)} (series)`),
    ];
    const allLabels = d.date_labels ?? [];

    return {
      id: d.id,
      code: d.code,
      packageId: d.package_id,
      seriesCode: s?.code ?? "",
      startDate: d.start_date,
      endDate: d.end_date,
      seasonId: d.season_id,
      season: (d.season_id ? seasons.get(d.season_id) : null) ?? d.season,
      itineraryId: d.itinerary_id,
      route: departureRouteLabel(arrival, d.return_airport ?? s?.ret ?? arrival),
      isPublished: d.is_published,
      saleStatus: d.sale_status,
      siteStatus: siteSaleStatus({ sale_status: d.sale_status, allocated: seats.allocated, remaining: seats.remaining }),
      currency: d.currency,
      capacity: d.capacity,
      seats,
      flight,
      flightCost:
        cost && cost.cost_price != null
          ? { amount: Number(cost.cost_price), currency: cost.cost_currency || "USD", more: Math.max(0, blocks.length - 1) }
          : null,
      prices,
      labels: allLabels.filter((l) => !isBarMitzvahLabel(l)),
      barMitzvah: allLabels.some(isBarMitzvahLabel),
      cardBadge: d.card_badge,
      discount:
        discount?.value == null
          ? null
          : discountText(discount.kind === "percent_order" ? { percent: Number(discount.value) } : { amount: Number(discount.value) }),
      discountUntil: discount?.value == null ? null : (discount.valid_until ?? null),
      gift: gift?.label ?? null,
      giftUntil: gift ? (gift.valid_until ?? null) : null,
      special: special?.label ?? null,
      specialAmount: special?.value == null ? null : Number(special.value),
      specialUntil: special ? (special.valid_until ?? null) : null,
      morePromotions: more,
      docket: d.docket_no,
      meetingAt: d.meeting_at,
      transfers: d.transfers_included,
      childMaxAge: d.child_max_age,
      seniorMinAge: d.senior_min_age,
      seniorDiscount: d.senior_discount == null ? null : Number(d.senior_discount),
      notes: d.notes,
      originFlightId: d.origin_flight_id,
    };
  });
}

/**
 * The organized tours and their sub-tours. `packageId` = one tour (its page's
 * sheet), else every organized tour. Past sub-tours are left out unless asked.
 */
export async function getPricingSheet(
  input: { packageId?: string | null; includePast?: boolean } = {},
): Promise<ActionResult<PricingSheetData>> {
  try {
    const { company } = await requireCompany("tours");
    const today = todayIso();
    const db = toursDb();
    const [packages, series, seasons, itineraries] = await Promise.all([
      fetchAll<{ id: string; name: string; slug: string; kind: string; is_active: boolean; is_deleted: string | null }>((from, to) =>
        db.from("packages").select("id, name, slug, kind, is_active, is_deleted").eq("company_id", company.id).order("id").range(from, to),
      ),
      fetchAll<{ code: string; package_id: string | null }>((from, to) =>
        db.from("series").select("code, package_id").eq("company_id", company.id).order("code").range(from, to),
      ),
      fetchAll<{ id: string; package_id: string; name: string; position: number }>((from, to) =>
        db
          .from("package_seasons")
          .select("id, package_id, name, position")
          .eq("company_id", company.id)
          .order("position")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAll<{ id: string; package_id: string; key: string; label: string | null }>((from, to) =>
        db
          .from("package_itineraries")
          .select("id, package_id, key, label")
          .eq("company_id", company.id)
          .neq("key", "main")
          .order("key")
          .order("id")
          .range(from, to),
      ),
    ]);
    const organized = packages.filter((p) => p.kind === "organized" && !p.is_deleted);
    const wanted = input.packageId ? organized.filter((p) => p.id === input.packageId) : organized;
    if (input.packageId && wanted.length === 0) {
      if (!UUID.test(input.packageId)) throw new UserError("Tour not found");
      return actionOk({ today, tours: [], rows: [] });
    }

    const rows = await loadSheetRows(company, { packageIds: wanted.map((p) => p.id), from: input.includePast ? null : today });
    const first = new Map<string, string>();
    for (const r of rows) if (!first.has(r.packageId)) first.set(r.packageId, r.startDate);
    const tours: SheetTour[] = wanted
      .filter((p) => input.packageId || first.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        codes: series.filter((s) => s.package_id === p.id).map((s) => s.code),
        isActive: p.is_active,
        seasons: seasons.filter((s) => s.package_id === p.id).map((s) => ({ id: s.id, name: s.name })),
        itineraries: itineraries.filter((v) => v.package_id === p.id).map((v) => ({ id: v.id, label: v.label || v.key })),
      }))
      .sort((a, b) => (first.get(a.id) ?? "9999").localeCompare(first.get(b.id) ?? "9999") || a.name.localeCompare(b.name, "he"));
    return actionOk({ today, tours, rows });
  } catch (e) {
    return fail(e);
  }
}

const asNumber = (v: SheetValue): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asText = (v: SheetValue): string | null => (typeof v === "string" ? v : null);
/** The cells that are promotions of the date, not fields of it. */
const PROMOTION_KEYS = ["discount", "discountUntil", "gift", "giftUntil", "special", "specialAmount", "specialUntil"];

/** The departure fields one row's changed cells set (prices, promotions and publishing go their own way). */
function fieldsOf(row: SheetRow, cells: SheetRowChange["cells"]): DepartureGeneralInput {
  const out: DepartureGeneralInput = {};
  for (const [key, { after }] of Object.entries(cells)) {
    switch (key) {
      case "saleStatus":
        out.sale_status = String(after ?? "");
        break;
      case "seasonId":
        out.season_id = asText(after);
        break;
      case "itineraryId":
        out.itinerary_id = asText(after);
        break;
      case "currency":
        out.currency = String(after ?? "");
        break;
      case "capacity":
        out.capacity = asNumber(after);
        break;
      case "cardBadge":
        out.card_badge = asText(after);
        break;
      case "docket":
        out.docket_no = asText(after);
        break;
      case "meetingAt":
        out.meeting_at = asText(after);
        break;
      case "transfers":
        out.transfers_included = after === true;
        break;
      case "childMaxAge":
        out.child_max_age = asNumber(after);
        break;
      case "seniorMinAge":
        out.senior_min_age = asNumber(after);
        break;
      case "seniorDiscount":
        out.senior_discount = asNumber(after);
        break;
      case "notes":
        out.notes = asText(after);
        break;
    }
  }
  // the labels and the bar / bat mitzvah mark are one list in the database
  if ("labels" in cells || "barMitzvah" in cells) {
    const labels = "labels" in cells && Array.isArray(cells.labels.after) ? cells.labels.after.map(String) : row.labels;
    if (labels.filter((l) => !isBarMitzvahLabel(l)).length > MAX_DATE_LABELS) throw new UserError(`Up to ${MAX_DATE_LABELS} labels on a date`);
    const bar = "barMitzvah" in cells ? cells.barMitzvah.after === true : row.barMitzvah;
    out.date_labels = dateLabelsOf(labels, bar);
  }
  return out;
}

/** The date's own active promotions of these kinds, one per kind (the first when the card holds several). */
async function ownPromotionsOf(company: Company, departureId: string, kinds: string[]): Promise<Map<string, PromoRow>> {
  const rows =
    must(
      await toursDb()
        .from("promotions")
        .select(PROMO_SELECT)
        .eq("company_id", company.id)
        .eq("departure_id", departureId)
        .eq("is_active", true)
        .in("kind", kinds)
        .order("id"),
    ) ?? [];
  const out = new Map<string, PromoRow>();
  for (const p of rows as PromoRow[]) if (!out.has(p.kind)) out.set(p.kind, p);
  return out;
}

/** What one promotion cell group asks for after the edit: the cell's new value, else what the row holds. */
const wanted = <T extends SheetValue>(cells: SheetRowChange["cells"], key: string, current: T): SheetValue => (key in cells ? cells[key].after : current);

/** A yyyy-mm-dd cell, or null. */
const asDay = (v: SheetValue): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * The date's own discount (a percent of the order or an amount per traveler), its
 * gift and its named discount, from the sheet's cells (Alon, 08.10.2026): each
 * is set, changed or switched off; a discount that changes kind switches the
 * other kind off first (the two are either/or). Answers why it stopped, or null.
 */
async function applyPromotions(company: Company, row: SheetRow, cells: SheetRowChange["cells"]): Promise<string | null> {
  const touched = (keys: string[]) => keys.some((k) => k in cells);
  const own = await ownPromotionsOf(company, row.id, ["percent_order", "fixed_per_pax", "gift", "named_per_pax"]);
  const switchOff = async (p: PromoRow | undefined): Promise<string | null> => {
    if (!p) return null;
    const off = await setPromotionActive(p.id, false);
    return off.success ? null : off.error;
  };
  const upsert = async (
    existing: PromoRow | undefined,
    input: { kind: PromotionKind; value: number | null; label: string | null; valid_until: string | null },
  ): Promise<string | null> => {
    const res = await savePromotion(row.id, existing?.id ?? null, { ...input, show_on_card: existing?.show_on_card ?? true, is_active: true });
    return res.success ? null : res.error;
  };

  if (touched(["discount", "discountUntil"])) {
    const text = asText(wanted(cells, "discount", row.discount));
    const until = asDay(wanted(cells, "discountUntil", row.discountUntil));
    const parsed = text ? parseDiscount(text) : null;
    if (parsed === undefined) return 'Discount: a percent ("10%") or an amount per traveler ("80")';
    const percent = own.get("percent_order");
    const fixed = own.get("fixed_per_pax");
    if (!parsed) {
      const p1 = await switchOff(percent);
      if (p1) return `Discount: ${p1}`;
      const p2 = await switchOff(fixed);
      if (p2) return `Discount: ${p2}`;
    } else {
      const kind: PromotionKind = "percent" in parsed ? "percent_order" : "fixed_per_pax";
      const rival = kind === "percent_order" ? fixed : percent;
      const off = await switchOff(rival);
      if (off) return `Discount: ${off}`;
      const existing = kind === "percent_order" ? percent : fixed;
      const problem = await upsert(existing, {
        kind,
        value: "percent" in parsed ? parsed.percent : parsed.amount,
        label: existing?.label ?? null,
        valid_until: until,
      });
      if (problem) return `Discount: ${problem}`;
    }
  }

  if (touched(["gift", "giftUntil"])) {
    const label = (asText(wanted(cells, "gift", row.gift)) ?? "").trim();
    const until = asDay(wanted(cells, "giftUntil", row.giftUntil));
    const existing = own.get("gift");
    const problem = label ? await upsert(existing, { kind: "gift", value: null, label, valid_until: until }) : await switchOff(existing);
    if (problem) return `Gift: ${problem}`;
  }

  if (touched(["special", "specialAmount", "specialUntil"])) {
    const label = (asText(wanted(cells, "special", row.special)) ?? "").trim();
    const amount = asNumber(wanted(cells, "specialAmount", row.specialAmount));
    const until = asDay(wanted(cells, "specialUntil", row.specialUntil));
    const existing = own.get("named_per_pax");
    if (label && amount && amount > 0) {
      const problem = await upsert(existing, { kind: "named_per_pax", value: amount, label, valid_until: until });
      if (problem) return `Special discount: ${problem}`;
    } else if (label || amount) {
      return label ? "Special discount: give it an amount per traveler (Special amount)" : "Special discount: give it a name (Special discount) - or clear the amount";
    } else {
      const problem = await switchOff(existing);
      if (problem) return `Special discount: ${problem}`;
    }
  }
  return null;
}

/** Writes one row; returns why it stopped (null when all of it was saved) and what is worth a look. */
async function applyRow(company: Company, row: SheetRow, cells: SheetRowChange["cells"]): Promise<{ stopped: string | null; notes: string[] }> {
  const done: string[] = [];
  const notes: string[] = [];
  const stop = (reason: string) => ({ stopped: done.length ? `${reason} (already saved: ${done.join(", ")})` : reason, notes });
  const publish = "isPublished" in cells ? cells.isPublished.after === true : null;

  // off the site first, so the checks below no longer hold the row as published
  if (publish === false && row.isPublished) {
    const res = await setDeparturesPublished([row.id], false);
    if (!res.success) return stop(res.error);
    if (res.data.skipped[0]) return stop(res.data.skipped[0].reason);
    done.push("taken off the site");
  }

  const fields = fieldsOf(row, cells);
  if (Object.keys(fields).length) {
    const res = await updateDeparture(row.id, fields);
    if (!res.success) return stop(res.error);
    done.push("details");
  }

  const priceKeys = Object.keys(cells).filter((k) => priceIndexOf(k) !== null);
  if (priceKeys.length) {
    const prices = [...row.prices];
    for (const key of priceKeys) {
      const value = cells[key].after;
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return stop(`Invalid price in ${key}`);
      prices[priceIndexOf(key)!] = value as number | null;
    }
    const res = await saveDeparturePrices(
      row.id,
      PRICE_MATRIX_ROWS.map((m, i) => ({ paxType: m.paxType, position: m.position, price: prices[i] })),
    );
    if (!res.success) return stop(res.error);
    done.push("prices");
  }

  if (PROMOTION_KEYS.some((k) => k in cells)) {
    const problem = await applyPromotions(company, row, cells);
    if (problem) return stop(problem);
    done.push("promotions");
  }

  // on the site last, once it has everything the site needs
  if (publish === true && !row.isPublished) {
    const res = await setDeparturesPublished([row.id], true);
    if (!res.success) return stop(res.error);
    if (res.data.skipped[0]) return stop(`Not put on the site: ${res.data.skipped[0].reason}`);
    if (res.data.warnings[0]) notes.push("On the site with no live flight - the site says the flight details will follow");
    const seasonId = "seasonId" in cells ? cells.seasonId.after : row.seasonId;
    if (!seasonId) notes.push("On the site with no season - assign one (Season column)");
  }
  return { stopped: null, notes };
}

export async function savePricingSheet(changes: SheetRowChange[]): Promise<ActionResult<SheetSaveOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    if (!Array.isArray(changes) || changes.length === 0) throw new UserError("Nothing to save");
    if (changes.length > MAX_ROWS_PER_SAVE) throw new UserError(`Up to ${MAX_ROWS_PER_SAVE} rows in one save`);
    for (const change of changes) {
      if (!change || !UUID.test(String(change.id)) || !change.cells || typeof change.cells !== "object") {
        throw new UserError("Invalid change in the sheet");
      }
      for (const key of Object.keys(change.cells)) {
        if (!EDITABLE_KEYS.has(key)) throw new UserError(`The column ${key} can't be edited here`);
      }
    }

    const ids = [...new Set(changes.map((c) => c.id))];
    const current = new Map((await loadSheetRows(company, { ids })).map((r) => [r.id, r]));
    const outcome: SheetSaveOutcome = { saved: [], skipped: [], notes: [], rows: [] };
    for (const change of changes) {
      const row = current.get(change.id);
      if (!row) {
        outcome.skipped.push({ id: change.id, code: "", reason: "Not found - it was deleted" });
        continue;
      }
      const stale = Object.entries(change.cells).some(([key, cell]) => !sameValue(cellValue(row, key), cell.before));
      if (stale) {
        outcome.skipped.push({
          id: row.id,
          code: row.code,
          reason: "Changed by someone else since the sheet was opened - your edits are kept; reload to see theirs",
        });
        continue;
      }
      let result: Awaited<ReturnType<typeof applyRow>>;
      try {
        result = await applyRow(company, row, change.cells);
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        result = { stopped: e.message, notes: [] };
      }
      for (const note of result.notes) outcome.notes!.push({ code: row.code, note });
      if (result.stopped) outcome.skipped.push({ id: row.id, code: row.code, reason: result.stopped });
      else outcome.saved.push(row.id);
    }

    outcome.rows = await loadSheetRows(company, { ids });
    if (outcome.saved.length || outcome.skipped.length) {
      revalidatePath("/tours/departures");
      revalidatePath("/tours/pricing");
    }
    return actionOk(outcome);
  } catch (e) {
    return fail(e);
  }
}
