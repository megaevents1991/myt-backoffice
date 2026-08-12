"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import {
  commissionForReservation,
  countReservationTickets,
  countTickets,
  isPaid,
  round2,
  type CommissionTerms,
} from "@/lib/partner-commission";
import {
  CUSTOMER_REFUND_NAME_MARKER,
  type CommissionType,
} from "@/types/partner.types";
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS,
  emptyTraffic,
  type PartnerTraffic,
} from "@/lib/partner-funnel";
import {
  ENTRY_SCAN_LIMIT,
  ENTRY_SCAN_SELECT,
  buildEntryFunnels,
  entryCountsFromRows,
  matchPaidUsers,
  paidCandidatesFrom,
  type EntryFunnels,
  type EntryScanRow,
} from "@/lib/partner-entry-funnels";
import { fetchPaged } from "@/lib/supabase-paged";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";
import {
  rangeWindowISO,
  type InsightsRange,
} from "@/lib/actions/partner-performance-actions";

export interface PartnersOverviewTopPartner {
  code: string;
  name: string;
  type: "agent" | "affiliate";
  paidReservations: number;
  tickets: number;
  salesUsd: number;
  commissionUsd: number;
  /** Distinct VISIT visitors in the window; 0 when tracking has none. */
  visitors: number;
  /** Paid ÷ visitors; null when no visitors. */
  conversionRate: number | null;
}

export interface HotEventPartnerShare {
  code: string;
  name: string;
  visitors: number;
  clicks: number;
}

export interface HotEventPaidShare {
  code: string;
  name: string;
  bookings: number;
  /** The event's own ticket line on those bookings, not the package total. */
  salesUsd: number;
}

export interface HotEvent {
  name: string;
  date: string | null;
  location: string | null;
  clicks: number;
  visitors: number;
  /** Distinct partners whose audiences clicked it. */
  partners: number;
  /** Who drove those clicks, largest first - the hover breakdown. */
  partnerBreakdown: HotEventPartnerShare[];
  /** PAID partner-attributed bookings of this event (name+day) in the window. */
  paidBookings: number;
  /** Which partners those paid bookings belong to - Converted's hover. */
  paidBreakdown: HotEventPaidShare[];
  /** paidBookings ÷ clicking visitors; null when no visitors. */
  conversionRate: number | null;
}

export interface PackagesSummary {
  created: number;
  locked: number;
  editable: number;
  /** Packages with a later PAID booking of the same event by the same partner -
   *  a match, not proof (links carry no reservation id back). */
  matched: number;
  topCreators: { code: string; name: string; count: number }[];
}

export type { EntryFunnels } from "@/lib/partner-entry-funnels";

export interface TopBookedEvent {
  name: string;
  date: string | null;
  bookings: number;
  tickets: number;
  salesUsd: number;
}

export interface PartnersOverview {
  range: InsightsRange;
  activeAgents: number;
  activeAffiliates: number;
  /** Marketing partners with at least one PAID attributed booking in range. */
  producingPartners: number;
  /** Marketing partners whose links brought at least one visitor in range. */
  producingTrafficPartners: number;
  /** (Commission + coupon discounts) per PAID ticket; null when none paid. */
  costPerConversionUsd: number | null;
  totalReservations: number;
  paidReservations: number;
  paidTickets: number;
  /** Tickets across ALL orders entered in the window, any status. */
  allTickets: number;
  /** Gross volume of ALL orders entered in the window, any status. */
  grossSalesUsd: number;
  /** PAID sales only - what the commission/net math runs on. */
  totalSalesUsd: number;
  /** Component costs on paid rows: flight price (or inventory cost when
   *  offline), hotel price (or inventory cost), the ticket line, coupons. */
  knownSupplierCostsUsd: number;
  /** Paid sales − commission − component costs. Conservative: the ticket
   *  line is SALE price, so our per-ticket sync markup hides inside costs. */
  netAfterCostsUsd: number;
  totalCommissionUsd: number;
  /** Sales minus partner commission - what stays with us BEFORE supplier
   *  costs (ticket/flight/hotel costs are not reliably in the data). */
  netAfterCommissionUsd: number;
  couponDiscountUsd: number;
  topPartners: PartnersOverviewTopPartner[];
  /** Funnel across ALL partner traffic in the window. */
  globalFunnel: PartnerTraffic;
  /** The same funnel split by entry page: home / artist / specific event. */
  entryFunnels: EntryFunnels;
  /** Distinct tracked users across every entry - the SAME universe the three
   *  entry-funnel cards count (home + artist + event + other), so the
   *  Conversion tile always agrees with the cards. Falls back to the global
   *  funnel's VISIT count when the entry split has no data. */
  trackedVisitors: number;
  /** Paid partner bookings ÷ trackedVisitors; null when no visitors. */
  globalConversionRate: number | null;
  /** Hot right now: most-clicked events across every partner's audience. */
  hotEvents: HotEvent[];
  /** Top 15 most-BOOKED events (paid) in the window, by tickets. */
  topBookedEvents: TopBookedEvent[];
  /** Prepared-package links built in the window. */
  packages: PackagesSummary;
  /** True when the reservation/package scan hit its row cap - every money and
   *  order tile then under-counts and the UI must say so, not imply totals. */
  truncated: boolean;
}

type PartnerRow = {
  partner_tracking_code: string;
  name_hebrew: string | null;
  email: string | null;
  type: string | null;
  is_active: boolean | null;
  commission: number | null;
  commission_type: CommissionType | null;
};

type ReservationRow = {
  id: number | string;
  created_at: string;
  status: string | null;
  user_shown_price: number | null;
  event_order_info: ReservationEventOrderInfo | null;
  aff_partner_tracking_code: string | null;
  coupon_discount_usd: number | null;
  event_id: number | null;
  offline_flight_cost: number | null;
  offline_hotel_cost: number | null;
  offline_hotel_ids: number[] | null;
  /** JSON sub-selects - component prices without dragging the raw offer blobs. */
  flight_price: number | string | null;
  flight_offline: boolean | null;
  hotel_price: number | string | null;
  hotel_offline: boolean | null;
};

/** Most-recent rows the money tiles aggregate over (was `.limit(5000)`). */
const RESERVATION_SCAN_LIMIT = 5000;
const PACKAGE_SCAN_LIMIT = 2000;

/**
 * Cross-partner rollup for the staff Partners Insights dashboard. Commission
 * math goes through lib/partner-commission per partner's own terms - the same
 * numbers the per-partner view and the partner's portal show.
 */
export async function getPartnersOverview(
  range: InsightsRange = "90d",
): Promise<PartnersOverview> {
  await requireStaff();

  const { from, to } = await rangeWindowISO(range);

  const reservationsQuery = () => {
    let q = supabase
      .from("reservations")
      .select(
        "id,created_at,status,user_shown_price,event_order_info,aff_partner_tracking_code,coupon_discount_usd,event_id,offline_flight_cost,offline_hotel_cost,offline_hotel_ids,commission_type,commission_rate,flight_price:flight_order_info->price,flight_offline:flight_order_info->isOffline,hotel_price:hotel_order_info->price,hotel_offline:hotel_order_info->isOffline",
      )
      .not("aff_partner_tracking_code", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    return q;
  };

  const packagesQuery = () => {
    let q = supabase
      .from("prepared_packages")
      .select("id,partner_tracking_code,event_id,allow_edit,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    return q;
  };

  const [
    partnersResult,
    reservationsResult,
    funnelResult,
    entryResult,
    hotResult,
    hotPartnersResult,
    visitorsResult,
    packagesResult,
  ] = await Promise.all([
    supabase
      .from("partners")
      .select(
        "partner_tracking_code,name_hebrew,email,type,is_active,commission,commission_type",
      )
      // Same server-side customer-refund exclusion as getPartners() - those
      // rows are ~95% of the table and would blow the 1000-row cap.
      .or(
        `name_hebrew.is.null,name_hebrew.not.ilike.*${CUSTOMER_REFUND_NAME_MARKER}*`,
      )
      .or("type.is.null,type.neq.customer_refund"),
    fetchPaged<ReservationRow>(reservationsQuery, RESERVATION_SCAN_LIMIT),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_funnel_counts_all", {
      p_from: from,
      p_to: to,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_entry_funnels_all", {
      p_from: from,
      p_to: to,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_clicked_events_all", {
      p_from: from,
      p_to: to,
      p_limit: 15,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_clicked_event_partners_all", {
      p_from: from,
      p_to: to,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_visitors_by_code", {
      p_from: from,
      p_to: to,
    }),
    fetchPaged<{
      id: number | string;
      partner_tracking_code: string;
      event_id: number | null;
      allow_edit: boolean | null;
      created_at: string;
    }>(packagesQuery, PACKAGE_SCAN_LIMIT),
  ]);

  if (partnersResult.error) throw partnersResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  // Never cap silently - the tiles read as totals, so say so when they aren't.
  if (reservationsResult.truncated) {
    console.warn(
      `getPartnersOverview: reservations capped at ${RESERVATION_SCAN_LIMIT} rows for range ${range}`,
    );
  }
  if (packagesResult.truncated) {
    console.warn(
      `getPartnersOverview: packages capped at ${PACKAGE_SCAN_LIMIT} rows for range ${range}`,
    );
  }
  // The tracking/holds/packages blocks are nice-to-have - log and degrade,
  // never fail the whole tab over one of them.
  for (const [label, result] of [
    ["funnel", funnelResult],
    ["entry", entryResult],
    ["hot", hotResult],
    ["hotPartners", hotPartnersResult],
    ["visitors", visitorsResult],
    ["packages", packagesResult],
  ] as const) {
    if (result.error) {
      console.error(
        `getPartnersOverview ${label}:`,
        JSON.stringify(result.error),
      );
    }
  }

  const partners = (partnersResult.data ?? []) as unknown as PartnerRow[];
  const partnerByCode = new Map<string, PartnerRow>();
  for (const partner of partners)
    partnerByCode.set(partner.partner_tracking_code, partner);

  const termsFor = (partner: PartnerRow): CommissionTerms => ({
    type: partner.commission_type ?? "fixed_per_ticket",
    rate: partner.commission ?? 0,
  });

  // Only bookings attributed to a real marketing partner - an unknown or
  // refund-row code is not partner production.
  const rows = reservationsResult.rows.filter(
    (r) =>
      r.aff_partner_tracking_code &&
      partnerByCode.has(r.aff_partner_tracking_code),
  );
  const paid = rows.filter(isPaid);

  const byPartner = new Map<string, PartnersOverviewTopPartner>();
  let totalCommission = 0;
  let paidTickets = 0;
  let couponDiscount = 0;

  for (const r of paid) {
    const code = r.aff_partner_tracking_code as string;
    const partner = partnerByCode.get(code) as PartnerRow;
    const commission = commissionForReservation(r, termsFor(partner));
    const tickets = countReservationTickets(r);
    const sales = r.user_shown_price ?? 0;

    totalCommission += commission;
    paidTickets += tickets;
    couponDiscount += Number(r.coupon_discount_usd ?? 0);

    const top = byPartner.get(code) ?? {
      code,
      name: partner.name_hebrew || partner.email || code,
      type:
        partner.type === "agent" ? ("agent" as const) : ("affiliate" as const),
      paidReservations: 0,
      tickets: 0,
      salesUsd: 0,
      commissionUsd: 0,
      // Filled from partners_visitors_by_code just before returning.
      visitors: 0,
      conversionRate: null,
    };
    top.paidReservations += 1;
    top.tickets += tickets;
    top.salesUsd += sales;
    top.commissionUsd = round2(top.commissionUsd + commission);
    byPartner.set(code, top);
  }

  const totalSales = paid.reduce(
    (sum, r) => sum + (r.user_shown_price ?? 0),
    0,
  );
  const grossSales = rows.reduce(
    (sum, r) => sum + (r.user_shown_price ?? 0),
    0,
  );
  const allTickets = countTickets(rows);

  // Costs on PAID rows, per Dor's model: every reservation carries its
  // component prices - flight (Amadeus price, or our inventory cost when
  // offline), hotel (Ratehawk price / inventory cost), tickets (the package's
  // ticket line - sale price incl. the per-ticket sync markup, so this net is
  // conservative), plus coupon discounts. Commission is subtracted separately.
  let knownSupplierCosts = 0;
  const topBooked = new Map<string, TopBookedEvent>();
  for (const r of paid) {
    const tickets = countReservationTickets(r);
    if (r.flight_offline === true && r.offline_flight_cost != null) {
      knownSupplierCosts +=
        Number(r.offline_flight_cost) * Math.max(1, tickets);
    } else if (
      r.flight_price != null &&
      Number.isFinite(Number(r.flight_price))
    ) {
      knownSupplierCosts += Number(r.flight_price);
    }
    if (r.hotel_offline === true && r.offline_hotel_cost != null) {
      const rooms = Math.max(1, r.offline_hotel_ids?.length ?? 1);
      knownSupplierCosts += Number(r.offline_hotel_cost) * rooms;
    } else if (
      r.hotel_price != null &&
      Number.isFinite(Number(r.hotel_price))
    ) {
      knownSupplierCosts += Number(r.hotel_price);
    }
    knownSupplierCosts += Number(r.coupon_discount_usd ?? 0);
    for (const item of normalizeReservationEventOrderInfo(r.event_order_info)) {
      knownSupplierCosts += Number(item?.total_tickets_price ?? 0);
    }

    for (const item of normalizeReservationEventOrderInfo(r.event_order_info)) {
      if (!item?.name) continue;
      const date =
        typeof item.date === "string"
          ? item.date
          : item.date
            ? String(item.date)
            : null;
      const key = `${item.name.trim().toLowerCase()}|${date ?? ""}`;
      const entry = topBooked.get(key) ?? {
        name: item.name,
        date,
        bookings: 0,
        tickets: 0,
        salesUsd: 0,
      };
      entry.bookings += 1;
      entry.tickets += item.number_of_ticket ?? 0;
      entry.salesUsd += item.total_tickets_price ?? 0;
      topBooked.set(key, entry);
    }
  }
  const topBookedEvents = [...topBooked.values()]
    .sort((a, b) => b.tickets - a.tickets || b.bookings - a.bookings)
    .slice(0, 15);

  // ---- Global funnel + per-partner visitors → conversion ----
  const stageCounts = new Map<string, number>();
  for (const row of (funnelResult.data ?? []) as {
    stage: string;
    visitors: number;
  }[]) {
    stageCounts.set(row.stage, Number(row.visitors) || 0);
  }
  let globalFunnel: PartnerTraffic = funnelResult.error
    ? emptyTraffic()
    : {
        byStage: FUNNEL_STAGES.map((stage) => ({
          stage,
          label: FUNNEL_STAGE_LABELS[stage],
          visitors: stageCounts.get(stage) ?? 0,
        })),
        totalVisitors: stageCounts.get("VISIT") ?? 0,
        hasData: stageCounts.size > 0,
      };

  const visitorsByCode = new Map<string, number>();
  for (const row of (visitorsResult.data ?? []) as {
    affiliate_id: string;
    visitors: number;
  }[]) {
    visitorsByCode.set(row.affiliate_id, Number(row.visitors) || 0);
  }

  // ---- Entry-segmented funnels (home / artist / event) ----
  let countsByEntry = new Map<string, Map<string, number>>();
  let entryApproximate = false;
  // Set when the fallback scan covered the whole window: real-partner-only
  // tracking rows, used to re-derive the RPC aggregates below (the deployed
  // RPCs still count refund-code browsing until the exclusion migration lands).
  let completeScanRows: EntryScanRow[] | null = null;
  if (!entryResult.error) {
    for (const row of (entryResult.data ?? []) as {
      entry: string;
      stage: string;
      visitors: number;
    }[]) {
      const perStage =
        countsByEntry.get(row.entry) ?? new Map<string, number>();
      perStage.set(row.stage, Number(row.visitors) || 0);
      countsByEntry.set(row.entry, perStage);
    }
  } else {
    // RPC not deployed yet (migration applies on merge to master) - degrade to
    // an ascending scan and compute the same aggregation here. The scan MUST
    // paginate: PostgREST's max-rows (1000) silently truncates anything bigger,
    // which is how this card once showed ~200 "visitors" for a 7.6k-row window.
    // Ascending keeps each covered user's first row (their entry) correct even
    // when the window itself is truncated at the cap.
    const scanQuery = () => {
      let q = supabase
        .from("affiliates_tracking")
        .select(ENTRY_SCAN_SELECT)
        .not("user_id", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lt("created_at", to);
      return q;
    };
    const scan = await fetchPaged<EntryScanRow>(scanQuery, ENTRY_SCAN_LIMIT);
    if (scan.error) {
      console.error(
        "getPartnersOverview entry scan:",
        JSON.stringify(scan.error),
      );
    }
    // Refund-credit browsing (personal "ניתן להתעלם" codes) is not partner
    // traffic - same exclusion the money tiles apply, now on tracking too.
    const scanRows = scan.rows.filter(
      (row) => row.affiliate_id && partnerByCode.has(row.affiliate_id),
    );
    if (!scan.truncated && !scan.error) completeScanRows = scanRows;
    if (scanRows.length) {
      // Partial coverage (cap hit, or an error after some pages) is served but
      // flagged - the UI's "approximate" note keys off this.
      entryApproximate = scan.truncated || scan.error != null;

      // Shared with the per-partner view - see lib/partner-entry-funnels.
      const paidUsers = matchPaidUsers(scanRows, paidCandidatesFrom(paid));
      countsByEntry = entryCountsFromRows(scanRows, paidUsers);
    }
  }
  const entryFunnels = buildEntryFunnels(countsByEntry, entryApproximate);

  // While the refund-exclusion migration hasn't landed, the deployed RPCs
  // still count refund-code browsing. When the scan covered the whole window,
  // re-derive the global funnel from its filtered rows instead.
  if (completeScanRows) {
    const usersByStage = new Map<string, Set<string>>();
    for (const row of completeScanRows) {
      if (!row.stage) continue;
      const set = usersByStage.get(row.stage) ?? new Set<string>();
      set.add(row.user_id);
      usersByStage.set(row.stage, set);
    }
    globalFunnel = {
      byStage: FUNNEL_STAGES.map((stage) => ({
        stage,
        label: FUNNEL_STAGE_LABELS[stage],
        visitors: usersByStage.get(stage)?.size ?? 0,
      })),
      totalVisitors: usersByStage.get("VISIT")?.size ?? 0,
      hasData: usersByStage.size > 0,
    };
  }

  // ---- Hot events across every partner's audience ----
  // Paid bookings per event, keyed by name+day (both sides normalize to
  // yyyy-mm-dd: tracking stores "2026-06-15", reservations an ISO midnight)
  // so two dates of the same tour convert separately; a name-only fallback
  // covers hot rows whose tracking carried no date.
  const paidByEventDay = new Map<string, number>();
  const paidByEventName = new Map<string, number>();
  type PaidShareAcc = Map<string, { bookings: number; salesUsd: number }>;
  const paidShareByDay = new Map<string, PaidShareAcc>();
  const paidShareByName = new Map<string, PaidShareAcc>();
  for (const r of paid) {
    const code = r.aff_partner_tracking_code as string;
    for (const item of normalizeReservationEventOrderInfo(r.event_order_info)) {
      if (!item?.name) continue;
      const name = item.name.trim().toLowerCase();
      const day = typeof item.date === "string" ? item.date.slice(0, 10) : "";
      paidByEventDay.set(
        `${name}|${day}`,
        (paidByEventDay.get(`${name}|${day}`) ?? 0) + 1,
      );
      paidByEventName.set(name, (paidByEventName.get(name) ?? 0) + 1);
      const sales = Number(item.total_tickets_price ?? 0);
      for (const [map, key] of [
        [paidShareByDay, `${name}|${day}`],
        [paidShareByName, name],
      ] as const) {
        const acc =
          map.get(key) ??
          new Map<string, { bookings: number; salesUsd: number }>();
        const share = acc.get(code) ?? { bookings: 0, salesUsd: 0 };
        share.bookings += 1;
        share.salesUsd += sales;
        acc.set(code, share);
        map.set(key, acc);
      }
    }
  }
  type HotSourceRow = {
    event_name: string | null;
    event_date: string | null;
    event_location: string | null;
    clicks: number | null;
    visitors: number | null;
    partners: number | null;
  };
  const partnerLabel = (code: string) => {
    const partner = partnerByCode.get(code);
    return partner?.name_hebrew || partner?.email || code;
  };
  const hotKey = (name: string, date: string | null, location: string | null) =>
    `${name}|${date ?? ""}|${location ?? ""}`;

  let hotSource: HotSourceRow[] = (hotResult.data ?? []) as HotSourceRow[];
  // Who drove each event's clicks - the hover breakdown behind the Partners
  // column, keyed like hotSource rows.
  const breakdownByKey = new Map<string, HotEventPartnerShare[]>();
  // Same interim override as the global funnel: full-window scan available →
  // recompute hot events refund-free (the deployed RPC can't filter yet).
  if (completeScanRows) {
    const byEvent = new Map<
      string,
      {
        row: HotSourceRow;
        users: Set<string>;
        perCode: Map<string, { users: Set<string>; clicks: number }>;
      }
    >();
    for (const row of completeScanRows) {
      if (row.stage !== "EVENT_SELECTED" || !row.event) continue;
      const key = hotKey(row.event, row.event_date, row.event_location);
      const entry = byEvent.get(key) ?? {
        row: {
          event_name: row.event,
          event_date: row.event_date,
          event_location: row.event_location,
          clicks: 0,
          visitors: 0,
          partners: 0,
        },
        users: new Set<string>(),
        perCode: new Map<string, { users: Set<string>; clicks: number }>(),
      };
      entry.row.clicks = Number(entry.row.clicks) + 1;
      entry.users.add(row.user_id);
      if (row.affiliate_id) {
        const share = entry.perCode.get(row.affiliate_id) ?? {
          users: new Set<string>(),
          clicks: 0,
        };
        share.users.add(row.user_id);
        share.clicks++;
        entry.perCode.set(row.affiliate_id, share);
      }
      byEvent.set(key, entry);
    }
    hotSource = [...byEvent.entries()]
      .map(([key, { row, users, perCode }]) => {
        breakdownByKey.set(
          key,
          [...perCode.entries()]
            .map(([code, share]) => ({
              code,
              name: partnerLabel(code),
              visitors: share.users.size,
              clicks: share.clicks,
            }))
            .sort((a, b) => b.visitors - a.visitors || b.clicks - a.clicks),
        );
        return { ...row, visitors: users.size, partners: perCode.size };
      })
      .sort(
        (a, b) =>
          Number(b.visitors) - Number(a.visitors) ||
          Number(b.clicks) - Number(a.clicks),
      )
      .slice(0, 15);
  } else if (!hotPartnersResult.error) {
    // Post-merge path: the per-partner RPC exists (and already excludes
    // refund codes); group its rows under the same keys hotSource uses.
    for (const row of (hotPartnersResult.data ?? []) as {
      event_name: string | null;
      event_date: string | null;
      event_location: string | null;
      affiliate_id: string | null;
      clicks: number | null;
      visitors: number | null;
    }[]) {
      if (!row.event_name || !row.affiliate_id) continue;
      const key = hotKey(row.event_name, row.event_date, row.event_location);
      const list = breakdownByKey.get(key) ?? [];
      list.push({
        code: row.affiliate_id,
        name: partnerLabel(row.affiliate_id),
        visitors: Number(row.visitors ?? 0),
        clicks: Number(row.clicks ?? 0),
      });
      breakdownByKey.set(key, list);
    }
    for (const list of breakdownByKey.values()) {
      list.sort((a, b) => b.visitors - a.visitors || b.clicks - a.clicks);
    }
  }
  const hotEvents: HotEvent[] = hotSource
    .filter((row) => !!row.event_name)
    .map((row) => {
      const name = (row.event_name as string).trim().toLowerCase();
      const visitors = Number(row.visitors ?? 0);
      const paidBookings = row.event_date
        ? (paidByEventDay.get(`${name}|${row.event_date.slice(0, 10)}`) ?? 0)
        : (paidByEventName.get(name) ?? 0);
      const paidShares = row.event_date
        ? paidShareByDay.get(`${name}|${row.event_date.slice(0, 10)}`)
        : paidShareByName.get(name);
      return {
        name: row.event_name as string,
        date: row.event_date,
        location: row.event_location,
        clicks: Number(row.clicks ?? 0),
        visitors,
        partners: Number(row.partners ?? 0),
        partnerBreakdown:
          breakdownByKey.get(
            hotKey(
              row.event_name as string,
              row.event_date,
              row.event_location,
            ),
          ) ?? [],
        paidBookings,
        paidBreakdown: paidShares
          ? [...paidShares.entries()]
              .map(([code, share]) => ({
                code,
                name: partnerLabel(code),
                bookings: share.bookings,
                salesUsd: round2(share.salesUsd),
              }))
              .sort(
                (a, b) => b.bookings - a.bookings || b.salesUsd - a.salesUsd,
              )
          : [],
        // Paid bookings are matched from ALL paid reservations (incl. package
        // deep-links that never fire EVENT_SELECTED), while visitors count
        // clickers only - the raw ratio can exceed 1 and read as "750%
        // converted". More paid than visitors just means "everything tracked
        // converted"; clamp instead of printing an impossible number.
        conversionRate:
          visitors > 0 ? Math.min(paidBookings / visitors, 1) : null,
      };
    });

  // ---- Prepared packages built in the window ----
  const packageRows = packagesResult.rows.filter((row) =>
    partnerByCode.has(row.partner_tracking_code),
  );
  const packagesByPartner = new Map<string, number>();
  let matched = 0;
  for (const row of packageRows) {
    packagesByPartner.set(
      row.partner_tracking_code,
      (packagesByPartner.get(row.partner_tracking_code) ?? 0) + 1,
    );
    // A later PAID booking of the same event by the same partner counts as a
    // match - links carry no reservation id back, so this is signal, not proof.
    if (
      row.event_id != null &&
      paid.some(
        (r) =>
          r.aff_partner_tracking_code === row.partner_tracking_code &&
          r.event_id === row.event_id &&
          r.created_at >= row.created_at,
      )
    ) {
      matched += 1;
    }
  }
  const packages: PackagesSummary = {
    created: packageRows.length,
    locked: packageRows.filter((row) => row.allow_edit === false).length,
    editable: packageRows.filter((row) => row.allow_edit !== false).length,
    matched,
    topCreators: [...packagesByPartner.entries()]
      .map(([code, count]) => ({
        code,
        name:
          partnerByCode.get(code)?.name_hebrew ||
          partnerByCode.get(code)?.email ||
          code,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };

  // The Conversion tile must agree with the three entry-funnel cards below it,
  // so it counts the same universe: every classified user across every entry.
  // (globalFunnel counts only users with a VISIT row - order deep-links had
  // none before main's Aug 2026 fix - and pre-migration its RPC still includes
  // refund-code browsing.)
  const entryVisitorsTotal =
    entryFunnels.home.totalVisitors +
    entryFunnels.artist.totalVisitors +
    entryFunnels.event.totalVisitors +
    entryFunnels.otherVisitors;
  const trackedVisitors =
    entryVisitorsTotal > 0 ? entryVisitorsTotal : globalFunnel.totalVisitors;

  return {
    range,
    activeAgents: partners.filter(
      (p) => p.type === "agent" && p.is_active !== false,
    ).length,
    activeAffiliates: partners.filter(
      (p) => p.type !== "agent" && p.is_active !== false,
    ).length,
    producingPartners: byPartner.size,
    producingTrafficPartners: [...visitorsByCode.entries()].filter(
      ([code, visitors]) => visitors > 0 && partnerByCode.has(code),
    ).length,
    costPerConversionUsd:
      paidTickets > 0
        ? round2((totalCommission + couponDiscount) / paidTickets)
        : null,
    totalReservations: rows.length,
    paidReservations: paid.length,
    paidTickets,
    allTickets,
    grossSalesUsd: round2(grossSales),
    totalSalesUsd: totalSales,
    knownSupplierCostsUsd: round2(knownSupplierCosts),
    netAfterCostsUsd: round2(totalSales - totalCommission - knownSupplierCosts),
    totalCommissionUsd: round2(totalCommission),
    netAfterCommissionUsd: round2(totalSales - totalCommission),
    couponDiscountUsd: round2(couponDiscount),
    topPartners: [...byPartner.values()]
      .map((top) => {
        const visitors = visitorsByCode.get(top.code) ?? 0;
        return {
          ...top,
          visitors,
          // Clamped for the same reason as hotEvents: paid reservations can
          // out-number VISIT-stage visitors (package deep-links) - >100% is
          // noise, not signal.
          conversionRate:
            visitors > 0 ? Math.min(top.paidReservations / visitors, 1) : null,
        };
      })
      .sort((a, b) => b.salesUsd - a.salesUsd)
      .slice(0, 10),
    globalFunnel,
    entryFunnels,
    trackedVisitors,
    globalConversionRate:
      trackedVisitors > 0 ? paid.length / trackedVisitors : null,
    hotEvents,
    topBookedEvents,
    packages,
    truncated: !!reservationsResult.truncated || !!packagesResult.truncated,
  };
}
