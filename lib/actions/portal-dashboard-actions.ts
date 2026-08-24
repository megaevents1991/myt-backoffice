"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import {
  commissionForReservation,
  commissionForReservations,
  countTickets,
  describeCommission,
  isPaid,
  round2,
  saleValue,
  sumSales,
  type CommissionTerms,
} from "@/lib/partner-commission";
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS_HE,
  emptyTraffic,
  type PartnerTraffic,
} from "@/lib/partner-funnel";
import {
  buildEntryFunnels,
  type EntryFunnels,
} from "@/lib/partner-entry-funnels";
import {
  fundedCouponCodesFor,
  quoteUpliftsFor,
} from "@/lib/actions/portal-coupon-actions";
import {
  rangeWindowISO,
  type InsightsRange,
} from "@/lib/actions/partner-performance-actions";
import { partnerLink } from "@/lib/site";
import {
  getAgentSlugForUser,
  agentUtmContent,
  resolvePortalScope,
  getReservationAttribution,
  visibleToAgent,
  mergedOwner as computeMergedOwner,
} from "@/lib/portal-attribution";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { CommissionType } from "@/types/partner.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/**
 * Everything the partner dashboard shows, in one round trip.
 *
 * The activity tiles, funnel, entry funnels and clicked events are scoped to
 * the requested time range (the top filter). The commission money tiles are
 * deliberately NOT ranged: pending/billed are read from the same `billed_at`
 * fact the monthly report bills on, and a windowed figure would disagree with
 * the invoice - the kind of ambiguity that turns into an argument about money.
 */

export interface PortalCommission {
  /** Ready-to-display rate, e.g. "$25 per ticket". */
  label: string;
  /** Earned since 1 January, all paid reservations. */
  yearToDateUsd: number;
  /**
   * Owed but not yet in a monthly report - reservations that are paid and
   * carry no `billed_at`. This is the same fact the report bills on, so the
   * portal and the invoice cannot drift apart.
   */
  pendingUsd: number;
  /** Already included in a monthly report. */
  billedUsd: number;
  /** The open orders behind pendingUsd - the drill-down the tile expands to
   *  (סוכן ומשפיען רוצים לראות מה מרכיב את המספר - דור, 2026-08-08). */
  pendingRows: PendingCommissionRow[];
}

export interface PendingCommissionRow {
  id: number;
  event: string | null;
  amountUsd: number;
}

export interface PortalClickedEvent {
  name: string;
  date: string | null;
  location: string | null;
  visitors: number;
  clicks: number;
  /** True when someone who clicked this event went on to book it. */
  booked: boolean;
}

/** A package that went live on the site in the last 30 days - the "מה חדש"
 *  rail. `href` is the partner's own tracking link to it. */
export interface PortalNewEvent {
  id: number;
  name: string;
  date: string | null;
  location: string | null;
  image_url: string | null;
  href: string;
}

/** One row of the manager's "per agent" breakdown table (office view). Built
 *  from PAID rows only, using the same sale-value accessor as the headline
 *  totalSalesUsd tile so the two never disagree. */
export interface AgentBreakdownRow {
  sub: string;
  name: string;
  totalReservations: number;
  paidReservations: number;
  totalSalesUsd: number;
}

export interface PortalDashboard {
  range: InsightsRange;
  totalReservations: number;
  paidReservations: number;
  paidTickets: number;
  totalSalesUsd: number;
  commission: PortalCommission;
  /** partners.user_discount, formatted for the influencer tile: 1–10 reads as
   *  a percent, anything larger as $ per ticket (the main app's rule). */
  userDiscountLabel: string;
  activeCoupons: number;
  couponUses: number;
  traffic: PartnerTraffic;
  /** The three entry-segmented funnels; null when the RPC isn't available. */
  entryFunnels: EntryFunnels | null;
  clickedEvents: PortalClickedEvent[];
  newEvents: PortalNewEvent[];
  /** "מה חדש" grouped one-card-per-artist (artist blob image; events matching
   *  no artist group under their own name). */
  newGroups: PortalNewGroup[];
  /** Most-picked flight routes / hotels / ticket categories on this partner's
   *  PAID bookings - the per-partner cut of the staff performance view. */
  topPicks: {
    flights: TopPick[];
    hotels: TopPick[];
    tickets: TopPick[];
  };
  /** Manager only - per office-user cut of the activity above (lifetime, not
   *  range-filtered). Null for agent/affiliate sessions. */
  agentBreakdown: AgentBreakdownRow[] | null;
}

type ReservationRow = {
  created_at: string;
  status: string | null;
  user_shown_price: number | null;
  id: number;
  event_order_info: ReservationEventOrderInfo | null;
  flight_order_info?: unknown;
  hotel_order_info?: unknown;
  quote_id?: number | null;
  partner_settlement_method?: string | null;
  billed_at: string | null;
  coupon_code: string | null;
  coupon_discount_usd: number | null;
  agent_user_id?: string | null;
};

/** One "most picked" line: a flight route / hotel / ticket category + count. */
export interface TopPick {
  label: string;
  count: number;
}

/** One "מה חדש" card: an artist (or standalone event) + its upcoming dates. */
export interface PortalNewGroup {
  key: string;
  name: string;
  image_url: string | null;
  events: {
    id: number;
    date: string | null;
    location: string | null;
    href: string;
  }[];
}

/** The main app's affiliate-discount rule: 1–10 is a percent of the package,
 *  anything else (> 0) is absolute USD per ticket. */
function describeUserDiscount(discount: number | null | undefined): string {
  const value = Number(discount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "לא מוגדרת";
  return value >= 1 && value <= 10 ? `${value}%` : `$${value} לכרטיס`;
}

export async function getPortalDashboard(
  range: InsightsRange = "all",
  view: "office" | "mine" = "office",
): Promise<PortalDashboard> {
  const session = await requirePartner();
  const code = session.partner_code;
  const scope = await resolvePortalScope(session);
  const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));
  const { from, to } = await rangeWindowISO(range);

  const today = new Date().toISOString().slice(0, 10);
  const newSince = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    partnerResult,
    reservationsInitial,
    couponsResult,
    funnelResult,
    clicksResult,
    entryResult,
    newEventsResult,
    fundedCodes,
    quoteUplifts,
  ] = await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type,user_discount")
      .eq("partner_tracking_code", code)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "id,created_at,status,user_shown_price,event_order_info,flight_order_info,hotel_order_info,quote_id,partner_settlement_method,billed_at,coupon_code,coupon_discount_usd,commission_type,commission_rate,agent_user_id",
      )
      .is("is_deleted", null)
      .eq("aff_partner_tracking_code", code),
    supabase
      .from("coupons")
      .select("is_active,times_used")
      .eq("partner_tracking_code", code),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_funnel_counts_range", {
      p_tracking_code: code,
      p_from: from,
      p_to: to,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_clicked_events_range", {
      p_tracking_code: code,
      p_from: from,
      p_to: to,
      p_limit: 8,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_entry_funnels_range", {
      p_tracking_code: code,
      p_from: from,
      p_to: to,
    }),
    supabase
      .from("events")
      .select("id,name,date,location,card_image_url,art_image_url,created_at")
      .is("is_deleted", null)
      .gte("date", today)
      .gte("created_at", newSince)
      .order("created_at", { ascending: false })
      // High enough that one big artist drop doesn't crowd everyone else out
      // of the rail - the cards group per artist anyway (גיוון - אלון).
      .limit(60),
    fundedCouponCodesFor(code),
    quoteUpliftsFor(code),
  ]);

  let reservationsResult = reservationsInitial;
  if (reservationsResult.error?.code === "42703") {
    // agent_user_id not migrated yet - retry without it; every row simply
    // merges to its UTM attribution below (override contributes nothing).
    reservationsResult = await supabase
      .from("reservations")
      .select(
        "id,created_at,status,user_shown_price,event_order_info,flight_order_info,hotel_order_info,quote_id,partner_settlement_method,billed_at,coupon_code,coupon_discount_usd,commission_type,commission_rate",
      )
      .is("is_deleted", null)
      .eq("aff_partner_tracking_code", code);
  }

  // A thrown error here used to take the WHOLE portal down with a bare
  // "Application error" page. Log loudly and degrade instead - a dashboard of
  // zeros with a working nav beats a dead portal.
  if (partnerResult.error) {
    console.error(
      "getPortalDashboard partner:",
      JSON.stringify(partnerResult.error),
    );
  }
  if (reservationsResult.error) {
    console.error(
      "getPortalDashboard reservations:",
      JSON.stringify(reservationsResult.error),
    );
  }
  // The rest are decoration - never fail the whole dashboard over them.
  if (couponsResult.error) {
    console.error(
      "getPortalDashboard coupons:",
      JSON.stringify(couponsResult.error),
    );
  }
  if (funnelResult.error) {
    console.error(
      "getPortalDashboard funnel:",
      JSON.stringify(funnelResult.error),
    );
  }
  if (clicksResult.error) {
    console.error(
      "getPortalDashboard clicks:",
      JSON.stringify(clicksResult.error),
    );
  }
  if (entryResult.error) {
    console.error(
      "getPortalDashboard entry funnels:",
      JSON.stringify(entryResult.error),
    );
  }
  if (newEventsResult.error) {
    console.error(
      "getPortalDashboard new events:",
      JSON.stringify(newEventsResult.error),
    );
  }

  const partner = partnerResult.data as {
    commission: number;
    commission_type: CommissionType | null;
    user_discount?: number | null;
  } | null;
  const terms: CommissionTerms = {
    type: partner?.commission_type ?? "fixed_per_ticket",
    rate: partner?.commission ?? 0,
    // Commission-funded coupons deduct their discount from the reservation
    // they were spent on - the same terms the monthly report bills with.
    fundedCouponCodes: fundedCodes,
    // Quote-priced margin belongs to the agent, on top of the base rate.
    upliftByReservationId: quoteUplifts,
  };

  const allRows = (reservationsResult.data ??
    []) as unknown as ReservationRow[];

  // Agent isolation (spec §5): an agent sees only reservations credited to
  // them (solo offices keep unattributed - pre-slug history). A manager sees
  // the whole office by default, or just their own attributed rows in "mine"
  // - no solo fallback for a manager, they always have a real slug. Affiliates
  // are untouched: isManager is false and role isn't "agent", so neither
  // branch fires and scopedRows stays the full set, exactly as today.
  const attribution = await getReservationAttribution(
    allRows.map((r) => r.id),
    scope.officeUsers,
  );
  // Manager-set override wins over the UTM-derived attribution everywhere
  // below (QA wave 2, 20.08; sentinel-aware since QA item 3, 21.08).
  const mergedOwner = (r: ReservationRow): string | null =>
    computeMergedOwner(r.agent_user_id, attribution.get(r.id) ?? null);
  let scopedRows = allRows;
  if (!scope.isManager && session.role === "agent") {
    scopedRows = allRows.filter((r) =>
      visibleToAgent(mergedOwner(r), session.sub, scope.soloOffice),
    );
  } else if (scope.isManager && view === "mine") {
    scopedRows = allRows.filter((r) => mergedOwner(r) === session.sub);
  }

  // Money tiles bill on the whole history; the activity tiles follow the
  // selected window. ISO strings compare correctly as strings.
  const rangedRows = scopedRows.filter(
    (r) =>
      (!from || (r.created_at ?? "") >= from) &&
      (!to || (r.created_at ?? "") < to),
  );
  const paidAll = scopedRows.filter(isPaid);
  const paidRanged = rangedRows.filter(isPaid);

  const yearPrefix = String(new Date().getUTCFullYear());

  const coupons = (couponsResult.data ?? []) as unknown as {
    is_active: boolean;
    times_used: number | null;
  }[];

  // Which of the clicked events actually converted, so the dashboard can say
  // "clicked, never booked" - that is the list worth acting on.
  // Every event on the reservation, not just the first - a two-event booking
  // would otherwise mark its second event "never booked", inverting the exact
  // signal this list exists to give.
  const bookedNames = new Set(
    paidAll
      .flatMap((r) => normalizeReservationEventOrderInfo(r.event_order_info))
      .map((event) => event?.name)
      .filter((name): name is string => !!name)
      .map((name) => name.trim().toLowerCase()),
  );

  const clickedEvents: PortalClickedEvent[] = (
    (clicksResult.data ?? []) as unknown as {
      event_name: string | null;
      event_date: string | null;
      event_location: string | null;
      visitors: number | null;
      clicks: number | null;
    }[]
  )
    .filter((row) => !!row.event_name)
    .map((row) => ({
      name: row.event_name as string,
      date: row.event_date,
      location: row.event_location,
      visitors: Number(row.visitors ?? 0),
      clicks: Number(row.clicks ?? 0),
      booked: bookedNames.has((row.event_name as string).trim().toLowerCase()),
    }));

  const stageCounts = new Map<string, number>();
  for (const row of (funnelResult.data ?? []) as {
    stage: string;
    visitors: number;
  }[]) {
    stageCounts.set(row.stage, Number(row.visitors) || 0);
  }
  const traffic: PartnerTraffic = funnelResult.error
    ? emptyTraffic()
    : {
        byStage: FUNNEL_STAGES.map((stage) => ({
          stage,
          label: FUNNEL_STAGE_LABELS_HE[stage],
          visitors: stageCounts.get(stage) ?? 0,
        })),
        // The GRAND total, not the VISIT stage: VISIT logging launched late,
        // so long-time influencers have thousands of distinct users in later
        // stages but a tiny VISIT count - "סה"כ מבקרים 59, בחרו כרטיסים 981"
        // read as broken (שגיא; אלון+דור, 2026-08-09). Every stage is a
        // distinct-user count, so the max is a floor for "everyone who came".
        totalVisitors: Math.max(0, ...[...stageCounts.values()]),
        hasData: stageCounts.size > 0,
      };

  // Entry-segmented funnels - fold the RPC's (entry, stage, visitors) rows the
  // same way the staff insights tab does.
  let entryFunnels: EntryFunnels | null = null;
  if (!entryResult.error) {
    const countsByEntry = new Map<string, Map<string, number>>();
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
    entryFunnels = buildEntryFunnels(countsByEntry, false);
  }

  // Most-picked picks across PAID bookings. Same permissive JSON reads as the
  // reservations page: provider payloads vary, a missing key just doesn't count.
  const flightCounts = new Map<string, number>();
  const hotelCounts = new Map<string, number>();
  const ticketCounts = new Map<string, number>();
  const bump = (map: Map<string, number>, label: string | null | undefined) => {
    const key = (label ?? "").trim();
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const row of scopedRows) {
    if (row.status !== "Paid") continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const offer = (row.flight_order_info as any)?.offer;
      const segs = offer?.itineraries?.[0]?.segments;
      if (Array.isArray(segs) && segs.length > 0) {
        // The airline, not the airport pair - "תראה לי את חברת התעופה ולא את
        // השדה" (דור, 2026-08-08).
        bump(
          flightCounts,
          segs[0]?.operating?.carrierName ?? segs[0]?.carrierCode ?? null,
        );
      }
    } catch {
      /* skip row */
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hotelInfo = row.hotel_order_info as any;
      bump(
        hotelCounts,
        hotelInfo?.hotel?.name ??
          hotelInfo?.hotel_name ??
          hotelInfo?.name ??
          null,
      );
    } catch {
      /* skip row */
    }
    const first = normalizeReservationEventOrderInfo(row.event_order_info)[0];
    if (first) {
      bump(
        ticketCounts,
        [first.name, first.category].filter(Boolean).join(" · ") || null,
      );
    }
  }
  const topOf = (map: Map<string, number>): TopPick[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

  const newEvents: PortalNewEvent[] = newEventsResult.error
    ? []
    : (
        (newEventsResult.data ?? []) as unknown as {
          id: number;
          name: string;
          date: string | null;
          location: { name?: string } | null;
          card_image_url: string | null;
          art_image_url: string | null;
        }[]
      ).map((event) => ({
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location?.name ?? null,
        image_url: event.card_image_url ?? event.art_image_url,
        href: partnerLink(code, event.id, undefined, agentUtm),
      }));

  // One card PER ARTIST/TEAM, not per event - the rail was "הכל אותו אומן"
  // and the template image (the site's own blob) is the card art. Sports
  // fixtures group under their HOME team - the earliest team name in the
  // event title, longer name breaking ties ("Manchester United" beats
  // "Manchester") - the same rule main uses. Events matching nothing group
  // under their own event name (דור + אלון, 2026-08-09).
  const norm = (value: string | null | undefined) =>
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9֐-׾]+/g, " ")
      .trim();
  const [artistsResult, teamsResult] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("artists")
      .select("name,name_english,image_url,art_image_url")
      .eq("is_active", true)
      .eq("is_deleted", false)
      .limit(400),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("football_teams")
      .select("name,name_english,image_url,art_image_url,logo_url")
      .eq("is_active", true)
      .eq("is_deleted", false)
      .limit(400),
  ]);
  if (artistsResult.error) {
    console.error(
      "getPortalDashboard artists:",
      JSON.stringify(artistsResult.error),
    );
  }
  if (teamsResult.error) {
    console.error(
      "getPortalDashboard teams:",
      JSON.stringify(teamsResult.error),
    );
  }
  type TemplateRow = {
    name: string | null;
    name_english: string | null;
    image_url: string | null;
    art_image_url: string | null;
    logo_url?: string | null;
  };
  const normalized = (rows: TemplateRow[], kind: "artist" | "team") =>
    rows.map((row) => ({
      ...row,
      kind,
      he: norm(row.name),
      en: norm(row.name_english),
    }));
  const artists = normalized(
    (artistsResult.data ?? []) as TemplateRow[],
    "artist",
  );
  const teams = normalized((teamsResult.data ?? []) as TemplateRow[], "team");

  const groupsByKey = new Map<string, PortalNewGroup>();
  for (const event of newEvents) {
    const eventName = norm(event.name);
    // Artists: substring hit. Teams: earliest position = home team.
    const artist = eventName
      ? artists.find(
          (candidate) =>
            (candidate.he && eventName.includes(candidate.he)) ||
            (candidate.en && eventName.includes(candidate.en)),
        )
      : undefined;
    const team =
      !artist && eventName
        ? teams
            .map((candidate) => {
              const positions = [candidate.he, candidate.en]
                .filter(Boolean)
                .map((needle) => eventName.indexOf(needle))
                .filter((position) => position >= 0);
              return positions.length
                ? {
                    candidate,
                    pos: Math.min(...positions),
                    len: Math.max(candidate.he.length, candidate.en.length),
                  }
                : null;
            })
            .filter(Boolean)
            .sort((a, b) => a!.pos - b!.pos || b!.len - a!.len)[0]?.candidate
        : undefined;
    const template = artist ?? team;
    const key = template
      ? `${template.kind}:${template.he || template.en}`
      : `event:${eventName || event.id}`;
    const group = groupsByKey.get(key) ?? {
      key,
      name: template?.name || template?.name_english || event.name,
      image_url:
        template?.image_url ??
        template?.art_image_url ??
        template?.logo_url ??
        event.image_url ??
        null,
      events: [],
    };
    // Best available art wins: template blob first, else first event image seen.
    if (!group.image_url && event.image_url) group.image_url = event.image_url;
    group.events.push({
      id: event.id,
      date: event.date,
      location: event.location,
      href: event.href,
    });
    groupsByKey.set(key, group);
  }
  // Variety top-up: the 30-day window is often all music drops. When fewer
  // than a handful of TEAM cards made it in, pull slightly older fixtures
  // (30–90 days back, still future-dated) so sports is always represented
  // (דור, 2026-08-09 - "שיהיה מגוון, גם אם ישנים מעט יותר").
  const MIN_TEAM_CARDS = 4;
  const teamCardCount = () =>
    [...groupsByKey.keys()].filter((key) => key.startsWith("team:")).length;
  if (teams.length > 0 && teamCardCount() < MIN_TEAM_CARDS) {
    const olderSince = new Date(Date.now() - 90 * 86_400_000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: olderRows, error: olderError } = await (supabase as any)
      .from("events")
      .select("id,name,date,location,card_image_url,art_image_url,created_at")
      .is("is_deleted", null)
      .gte("date", today)
      .gte("created_at", olderSince)
      .lt("created_at", newSince)
      .order("created_at", { ascending: false })
      .limit(80);
    if (olderError) {
      console.error(
        "getPortalDashboard sports top-up:",
        JSON.stringify(olderError),
      );
    } else {
      for (const raw of (olderRows ?? []) as {
        id: number;
        name: string;
        date: string | null;
        location: { name?: string } | null;
        card_image_url: string | null;
        art_image_url: string | null;
      }[]) {
        if (teamCardCount() >= MIN_TEAM_CARDS) break;
        const eventName = norm(raw.name);
        if (!eventName) continue;
        // Team-matched fixtures only - the top-up exists for sports variety.
        const match = teams
          .map((candidate) => {
            const positions = [candidate.he, candidate.en]
              .filter(Boolean)
              .map((needle) => eventName.indexOf(needle))
              .filter((position) => position >= 0);
            return positions.length
              ? {
                  candidate,
                  pos: Math.min(...positions),
                  len: Math.max(candidate.he.length, candidate.en.length),
                }
              : null;
          })
          .filter(Boolean)
          .sort((a, b) => a!.pos - b!.pos || b!.len - a!.len)[0]?.candidate;
        if (!match) continue;
        const key = `team:${match.he || match.en}`;
        const group = groupsByKey.get(key) ?? {
          key,
          name: match.name || match.name_english || raw.name,
          image_url:
            match.image_url ??
            match.art_image_url ??
            match.logo_url ??
            raw.card_image_url ??
            raw.art_image_url ??
            null,
          events: [],
        };
        group.events.push({
          id: raw.id,
          date: raw.date,
          location: raw.location?.name ?? null,
          href: partnerLink(code, raw.id, undefined, agentUtm),
        });
        groupsByKey.set(key, group);
      }
    }
  }

  const newGroups = [...groupsByKey.values()].map((group) => ({
    ...group,
    events: group.events.sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? ""),
    ),
  }));

  // Manager's per-agent cut - lifetime, like the commission money tiles below
  // (NOT range-filtered, unlike the paidReservations/totalSalesUsd activity
  // tiles) - and always the WHOLE office regardless of the office/mine
  // toggle, so switching to "mine" never hides colleagues from this table.
  // isPaid/saleValue are the same accessors paidAll (and its derived
  // totalSalesUsd) use above, so this table's totals agree with paidAll to
  // the cent - they just don't match the range-scoped headline tiles.
  const agentBreakdown: AgentBreakdownRow[] | null = scope.isManager
    ? (() => {
        const rows = new Map<string, AgentBreakdownRow>();
        for (const u of scope.officeUsers) {
          rows.set(u.id, {
            sub: u.id,
            name: u.display_name || u.email,
            totalReservations: 0,
            paidReservations: 0,
            totalSalesUsd: 0,
          });
        }
        const unattributed: AgentBreakdownRow = {
          sub: "",
          name: "לא משויך",
          totalReservations: 0,
          paidReservations: 0,
          totalSalesUsd: 0,
        };
        for (const r of allRows) {
          const owner = mergedOwner(r);
          // A non-null owner missing from the roster (staff moved them to a
          // different office after this reservation was attributed) folds
          // into "לא משויך" too, same as no owner at all - never dropped.
          const row = (owner ? rows.get(owner) : undefined) ?? unattributed;
          row.totalReservations += 1;
          if (isPaid(r)) {
            row.paidReservations += 1;
            row.totalSalesUsd += saleValue(r);
          }
        }
        const list = [...rows.values()].sort(
          (a, b) => b.totalSalesUsd - a.totalSalesUsd,
        );
        if (unattributed.totalReservations > 0) list.push(unattributed);
        return list;
      })()
    : null;

  return {
    range,
    totalReservations: rangedRows.length,
    paidReservations: paidRanged.length,
    paidTickets: countTickets(paidRanged),
    totalSalesUsd: sumSales(paidRanged),
    commission: {
      label: describeCommission(terms),
      yearToDateUsd: round2(
        commissionForReservations(
          paidAll.filter((r) => r.created_at?.startsWith(yearPrefix)),
          terms,
        ),
      ),
      pendingUsd: round2(
        commissionForReservations(
          paidAll.filter((r) => !r.billed_at),
          terms,
        ),
      ),
      billedUsd: round2(
        commissionForReservations(
          paidAll.filter((r) => !!r.billed_at),
          terms,
        ),
      ),
      // One line per open order, matching pendingUsd to the cent.
      pendingRows: paidAll
        .filter((r) => !r.billed_at)
        .map((r) => ({
          id: r.id,
          event:
            normalizeReservationEventOrderInfo(r.event_order_info)[0]?.name ??
            null,
          amountUsd: round2(commissionForReservation(r, terms)),
        }))
        .filter((row) => row.amountUsd > 0)
        .sort((a, b) => b.amountUsd - a.amountUsd),
    },
    userDiscountLabel: describeUserDiscount(partner?.user_discount),
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
    traffic,
    entryFunnels,
    clickedEvents,
    newEvents,
    newGroups,
    topPicks: {
      flights: topOf(flightCounts),
      hotels: topOf(hotelCounts),
      tickets: topOf(ticketCounts),
    },
    agentBreakdown,
  };
}
