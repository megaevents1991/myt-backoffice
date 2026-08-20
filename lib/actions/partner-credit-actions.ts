"use server";

import { requireCreditAccess, requireOfficeManager, requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import {
  PAID_STATUS,
  countTickets,
  creditAccrued,
  isPaid,
  round2,
  wasSettledAtCutoff,
} from "@/lib/partner-commission";
import {
  getOfficeUsers,
  getReservationAttribution,
  resolvePortalScope,
  type OfficeUser,
} from "@/lib/portal-attribution";
import type { SessionPayload } from "@/lib/auth/session";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/**
 * Partner site credit: accrued per ticket on paid reservations, converted into
 * coupons the partner spends on the site.
 *
 * Nothing here is a stored counter. The balance is always
 *   accrued + returned - redeemed
 * derived from the reservations and the redemption ledger every time, so it
 * cannot drift, and a retried or half-finished conversion cannot inflate it.
 */

export interface PartnerCredit {
  creditPerTicket: number;
  /** Everything ever earned from paid tickets. */
  accruedUsd: number;
  /** Everything ever turned into coupons. */
  redeemedUsd: number;
  /** Coupon value that came back unspent - see settleRedemptions. */
  returnedUsd: number;
  /** What can be converted right now. */
  balanceUsd: number;
  /**
   * How far redemptions exceed what is accrued today (0 when balanced).
   * Happens when paid orders are re-marked Lost/Cancelled AFTER their credit
   * was already converted - the balance floors at 0 and new accrual silently
   * fills the hole. Surfaced so a partner sees WHY new credit "doesn't count"
   * instead of concluding accrual is broken (אלון, 2026-08-06).
   */
  deficitUsd: number;
  paidTickets: number;
  history: PartnerCreditRedemption[];
}

export interface PartnerCreditRedemption {
  id: number;
  amount_usd: number;
  coupon_code: string;
  created_at: string;
  /** Coupon value actually spent, once the coupon has been used. */
  used_usd: number;
  /** Unspent value handed back to the balance. Only set once used. */
  returned_usd: number;
  /** True while the coupon is still live and unspent. */
  outstanding: boolean;
}

type ReservationRow = {
  status: string | null;
  event_order_info: ReservationEventOrderInfo | null;
  /** ISO timestamp; compared as a string against the accrual start date. */
  created_at: string | null;
  billed_at: string | null;
  /** Only selected (and only meaningful) in a scoped loadCredit call - see
   *  CreditScope below. */
  id?: number;
  agent_user_id?: string | null;
};

/** One row per coupon code, from the partner_coupon_usage RPC. */
type CouponUseRow = {
  code: string | null;
  used_usd: number | null;
  paid_uses: number | null;
};

/** What the coupons table says about a code, regardless of any booking. */
type CouponStateRow = {
  code: string | null;
  times_used: number | null;
  max_uses: number | null;
};

/** The ledger row as stored - the settled fields are derived, not columns. */
type LedgerRow = Pick<
  PartnerCreditRedemption,
  "id" | "amount_usd" | "coupon_code" | "created_at"
>;

/**
 * Work out what each coupon actually cost us.
 *
 * The main app writes `reservations.coupon_discount_usd` - the amount of the
 * coupon it really applied - so a $200 coupon spent on a $60 booking is visible
 * here without the main app needing to know anything about partner credit.
 * The unused $140 goes back to the balance rather than evaporating.
 *
 * Credit only returns once the coupon has actually been used. While it is live
 * and unspent the full amount stays deducted, because the partner could still
 * spend all of it.
 */
function settleRedemptions(
  history: LedgerRow[],
  couponUses: CouponUseRow[],
  couponStates: CouponStateRow[],
): { settled: PartnerCreditRedemption[]; returnedUsd: number } {
  const spentByCode = new Map<string, number>();
  for (const use of couponUses) {
    const code = (use.code ?? "").trim().toUpperCase();
    if (!code) continue;
    spentByCode.set(code, Number(use.used_usd ?? 0));
  }

  // A coupon is spent when the coupons table says so, which is not the same as
  // "it appears on a paid booking". `times_used` is bumped when the coupon is
  // APPLIED; a booking that was applied and then abandoned or cancelled leaves
  // the coupon dead but never reaches Paid. Without this, such a coupon would
  // read as available forever and its value would never come back.
  const consumedCodes = new Set<string>();
  for (const state of couponStates) {
    const code = (state.code ?? "").trim().toUpperCase();
    if (!code) continue;
    const used = Number(state.times_used ?? 0);
    const max = state.max_uses == null ? Infinity : Number(state.max_uses);
    if (used >= max) consumedCodes.add(code);
  }

  let returnedUsd = 0;
  const settled = history.map((row) => {
    const amount = Number(row.amount_usd ?? 0);
    const code = (row.coupon_code ?? "").trim().toUpperCase();
    const used = round2(spentByCode.get(code) ?? 0);
    const consumed = consumedCodes.has(code) || spentByCode.has(code);

    if (!consumed) {
      // Still live and unspent - the partner could yet spend all of it, so the
      // full amount stays deducted.
      return { ...row, used_usd: 0, returned_usd: 0, outstanding: true };
    }
    if (used <= 0) {
      // Spent, but we cannot see for how much. Return nothing rather than hand
      // back credit we cannot prove went unused.
      console.warn(
        `partner credit: coupon ${code} is consumed but no discount was recorded on any Paid reservation - nothing returned.`,
      );
      return { ...row, used_usd: 0, returned_usd: 0, outstanding: false };
    }
    // Never return more than was converted, however the discount was recorded.
    const returned = round2(Math.max(0, amount - used));
    returnedUsd += returned;
    return {
      ...row,
      used_usd: used,
      returned_usd: returned,
      outstanding: false,
    };
  });

  return { settled, returnedUsd: round2(returnedUsd) };
}

/**
 * Which bucket of the OFFICE's money loadCredit computes (QA wave 2, 20.08 -
 * "the accrual is per-agent, not per-office"). Undefined = today's
 * unscoped office-level total (solo offices / affiliates - byte-identical to
 * the pre-wave-2 behavior, zero extra queries). `officeUsers` is passed in
 * by the caller (already fetched via resolvePortalScope) rather than
 * refetched here.
 */
interface CreditScope {
  /** Bucket owner: paid reservations / redemptions attributed to this user. */
  agentSub: string;
  /** Manager buckets only - also fold in reservations/redemptions with no
   *  resolved owner ("לא משויך"). */
  includeUnattributed: boolean;
  officeUsers: OfficeUser[];
}

async function loadCredit(
  trackingCode: string,
  scope?: CreditScope,
): Promise<PartnerCredit> {
  const reservationColumns = scope
    ? "id,status,event_order_info,created_at,billed_at,agent_user_id"
    : "status,event_order_info,created_at,billed_at";
  const [partnerResult, reservationsInitial, redemptionsResult] =
    await Promise.all([
      supabase
        .from("partners")
        .select("credit_per_ticket,credit_accrual_start")
        .eq("partner_tracking_code", trackingCode)
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("reservations")
        .select(reservationColumns)
        .eq("aff_partner_tracking_code", trackingCode),
      supabase
        .from("partner_credit_redemptions")
        .select("id,amount_usd,coupon_code,coupon_id,created_at,created_by")
        .eq("partner_tracking_code", trackingCode)
        .order("created_at", { ascending: false }),
    ]);

  if (partnerResult.error) throw partnerResult.error;
  let reservationsResult = reservationsInitial;
  if (scope && reservationsResult.error?.code === "42703") {
    // agent_user_id not migrated yet - retry without it; every reservation
    // simply merges to its UTM attribution below (override contributes
    // nothing until the migration lands).
    reservationsResult = await supabase
      .from("reservations")
      .select("id,status,event_order_info,created_at,billed_at")
      .eq("aff_partner_tracking_code", trackingCode);
  }
  if (reservationsResult.error) throw reservationsResult.error;
  if (redemptionsResult.error) throw redemptionsResult.error;

  const partnerRow = partnerResult.data as {
    credit_per_ticket: number;
    credit_accrual_start: string | null;
  } | null;
  const creditPerTicket = partnerRow?.credit_per_ticket ?? 0;
  const accrualStart = partnerRow?.credit_accrual_start ?? null;

  // Only reservations from the partner's accrual start earn credit. Everything
  // before it was settled outside this system, and without the cut-off, setting
  // a rate would hand the partner their entire booking history as new credit.
  //
  // An old booking PAID after the cutoff was never part of the settlement, so
  // it still earns credit - matching how commission treats it.
  //
  // The test is `wasSettledAtCutoff`, not "has billed_at": the cron stamps that
  // same column every month, so a plain null-check would include such a booking
  // today and silently drop it the moment it is billed, shrinking the partner's
  // balance for no visible reason.
  const allReservations = (reservationsResult.data ??
    []) as unknown as ReservationRow[];
  let reservations = accrualStart
    ? allReservations.filter(
        (r) =>
          (r.created_at ?? "") >= accrualStart ||
          !wasSettledAtCutoff(r.billed_at),
      )
    : allReservations;

  if (scope) {
    // Manager-set override wins over the UTM-derived attribution, same as
    // every other consumer (QA wave 2, 20.08).
    const attribution = await getReservationAttribution(
      reservations.map((r) => r.id ?? -1),
      scope.officeUsers,
    );
    // An override can point at a user who has since left this office (staff
    // moved them elsewhere) - treat that the same as unattributed rather
    // than losing the money into a bucket nobody's view ever sums, so the
    // manager's own bucket + everyone else's still totals the office figure.
    const officeUserIds = new Set(scope.officeUsers.map((u) => u.id));
    reservations = reservations.filter((r) => {
      const rawOwner = r.agent_user_id ?? (attribution.get(r.id ?? -1) ?? null);
      const owner = rawOwner && officeUserIds.has(rawOwner) ? rawOwner : null;
      return (
        owner === scope.agentSub || (owner === null && scope.includeUnattributed)
      );
    });
  }

  const rawHistory = (redemptionsResult.data ??
    []) as unknown as (LedgerRow & {
    coupon_id: number | null;
    created_by: string | null;
  })[];

  // Per-agent redemption scoping (QA wave 2, 20.08; rebucketed in the 20.08
  // fix batch - the original version joined coupons.created_by, which 42703s
  // during the deploy<->migration window: every redemption then read as
  // unowned, so a non-manager agent's OWN redemptions vanished from their
  // scoped history, their computed redeemedUsd read as 0, and the balance
  // check let them convert their full accrued balance again - a double
  // spend. Also, any coupon created in that window kept coupons.created_by
  // NULL forever.).
  //
  // partner_credit_redemptions.created_by fixes both: it is stamped with the
  // actor on every conversion insert below, and - unlike coupons.created_by,
  // added later - it has existed since the original credit migration
  // (20260729195000), so it is never behind an unapplied migration. Null
  // only for legacy rows that predate this feature, which fall into the
  // manager bucket exactly like any other unresolved owner.
  let scopedHistory: (LedgerRow & {
    coupon_id: number | null;
    created_by: string | null;
  })[] = rawHistory;
  if (scope) {
    // Same "left the office" fallback as the reservations filter above.
    const officeUserIds = new Set(scope.officeUsers.map((u) => u.id));
    scopedHistory = rawHistory.filter((row) => {
      const rawOwner = row.created_by ?? null;
      const owner =
        rawOwner && officeUserIds.has(rawOwner) ? rawOwner : null;
      return (
        owner === scope.agentSub || (owner === null && scope.includeUnattributed)
      );
    });
  }

  // Anyone can redeem a partner's coupon, so usage is NOT scoped to the
  // partner's own attributed reservations - it is keyed on the coupon codes.
  // The RPC folds case the same way the count_coupon_paid_use trigger does,
  // because `reservations.coupon_code` stores whatever the customer typed; a
  // case-sensitive match would miss a lower-case entry and the partner would
  // simply lose the unspent remainder.
  const codes = scopedHistory
    .map((row) => (row.coupon_code ?? "").trim())
    .filter(Boolean);

  let couponUses: CouponUseRow[] = [];
  let couponStates: CouponStateRow[] = [];
  if (codes.length > 0) {
    const [usageResult, stateResult] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("partner_coupon_usage", { p_codes: codes }),
      supabase
        .from("coupons")
        .select("code,times_used,max_uses")
        .eq("partner_tracking_code", trackingCode),
    ]);
    if (usageResult.error) throw usageResult.error;
    if (stateResult.error) throw stateResult.error;
    couponUses = (usageResult.data ?? []) as unknown as CouponUseRow[];
    couponStates = (stateResult.data ?? []) as unknown as CouponStateRow[];
  }

  const { settled, returnedUsd } = settleRedemptions(
    scopedHistory,
    couponUses,
    couponStates,
  );

  const accruedUsd = round2(creditAccrued(reservations, creditPerTicket));
  const redeemedUsd = round2(
    settled.reduce((sum, r) => sum + Number(r.amount_usd ?? 0), 0),
  );

  return {
    creditPerTicket,
    accruedUsd,
    redeemedUsd,
    returnedUsd,
    balanceUsd: Math.max(0, round2(accruedUsd + returnedUsd - redeemedUsd)),
    deficitUsd: Math.max(0, round2(redeemedUsd - accruedUsd - returnedUsd)),
    // Tickets, not reservations - this sits next to the accrued amount, which
    // is priced per ticket, so a row count would contradict it.
    paidTickets: countTickets(reservations.filter(isPaid)),
    history: settled,
  };
}

/**
 * Resolves which bucket the signed-in session should see (QA wave 2, 20.08):
 * affiliate or a solo office keep today's office-level total untouched
 * (undefined scope - zero extra queries in loadCredit); a multi-user office's
 * agent sees only their own bucket; its manager sees their own bucket PLUS
 * whatever has no resolved owner ("לא משויך" absorbs into the manager, per
 * Dor - "הצבירה היא לכל סוכן לא למנהל המשרד").
 *
 * Shared by getMyCredit and convertCreditToCoupon so a conversion is checked
 * and recorded against the EXACT balance the partner is looking at.
 */
async function creditScopeForSession(
  session: SessionPayload & { partner_code: string },
): Promise<CreditScope | undefined> {
  if (session.role === "affiliate") return undefined;
  const scope = await resolvePortalScope(session);
  if (scope.soloOffice) return undefined;
  return {
    agentSub: session.sub,
    includeUnattributed: session.role === "office_manager",
    officeUsers: scope.officeUsers,
  };
}

/** The signed-in partner's own credit (their own bucket in a multi-user
 *  office - see creditScopeForSession). */
export async function getMyCredit(): Promise<PartnerCredit> {
  const session = await requireCreditAccess();
  const scope = await creditScopeForSession(session);
  return loadCredit(session.partner_code, scope);
}

/**
 * Manager-only leaderboard: every office user's accrued / redeemed / balance,
 * in one pass over the office's paid reservations + attribution + redemptions
 * (not N calls to loadCredit). The manager's own row already absorbs
 * unattributed money - same rule getMyCredit uses for them - so this table's
 * balances sum to the office total loadCredit(trackingCode) (unscoped) would
 * report.
 */
export interface AgentCreditBreakdownRow {
  sub: string;
  name: string;
  accruedUsd: number;
  redeemedUsd: number;
  balanceUsd: number;
}

export async function getOfficeCreditBreakdown(): Promise<
  AgentCreditBreakdownRow[]
> {
  const session = await requireOfficeManager();
  const code = session.partner_code;

  const [officeUsers, partnerResult, reservationsInitial, redemptionsResult] =
    await Promise.all([
      getOfficeUsers(code),
      supabase
        .from("partners")
        .select("credit_per_ticket,credit_accrual_start")
        .eq("partner_tracking_code", code)
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("reservations")
        .select("id,status,event_order_info,created_at,billed_at,agent_user_id")
        .eq("aff_partner_tracking_code", code),
      supabase
        .from("partner_credit_redemptions")
        .select("amount_usd,created_by")
        .eq("partner_tracking_code", code),
    ]);

  // getOfficeUsers fails CLOSED (null on a query error) - mirror that here
  // rather than showing a leaderboard that might be missing rows.
  if (officeUsers === null) return [];
  if (partnerResult.error) {
    console.error(
      "getOfficeCreditBreakdown partner:",
      JSON.stringify(partnerResult.error),
    );
    return [];
  }

  let reservationsResult = reservationsInitial;
  if (reservationsResult.error?.code === "42703") {
    reservationsResult = await supabase
      .from("reservations")
      .select("id,status,event_order_info,created_at,billed_at")
      .eq("aff_partner_tracking_code", code);
  }
  if (reservationsResult.error) {
    console.error(
      "getOfficeCreditBreakdown reservations:",
      JSON.stringify(reservationsResult.error),
    );
    return [];
  }

  if (redemptionsResult.error) {
    console.error(
      "getOfficeCreditBreakdown redemptions:",
      JSON.stringify(redemptionsResult.error),
    );
  }

  const partnerRow = partnerResult.data as {
    credit_per_ticket: number;
    credit_accrual_start: string | null;
  } | null;
  const creditPerTicket = partnerRow?.credit_per_ticket ?? 0;
  const accrualStart = partnerRow?.credit_accrual_start ?? null;

  const allReservations = (reservationsResult.data ??
    []) as unknown as ReservationRow[];
  const reservations = accrualStart
    ? allReservations.filter(
        (r) =>
          (r.created_at ?? "") >= accrualStart ||
          !wasSettledAtCutoff(r.billed_at),
      )
    : allReservations;

  const attribution = await getReservationAttribution(
    reservations.map((r) => r.id ?? -1),
    officeUsers,
  );

  // Manager absorbs anything with no resolved owner - same rule
  // creditScopeForSession applies to getMyCredit, so this leaderboard and
  // the manager's own card always agree. An owner who has since left this
  // office (staff moved them elsewhere) falls back the same way, so every
  // row's money still lands in a bucket this table actually sums.
  const managerSub = session.sub;
  const officeUserIds = new Set(officeUsers.map((u) => u.id));
  const inOffice = (id: string | null): string | null =>
    id && officeUserIds.has(id) ? id : null;

  const reservationsByOwner = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    const owner = inOffice(r.agent_user_id ?? (attribution.get(r.id ?? -1) ?? null));
    const bucket = owner ?? managerSub;
    const list = reservationsByOwner.get(bucket) ?? [];
    list.push(r);
    reservationsByOwner.set(bucket, list);
  }

  const redeemedByOwner = new Map<string, number>();
  for (const row of (redemptionsResult.data ?? []) as unknown as {
    amount_usd: number;
    created_by: string | null;
  }[]) {
    const owner = inOffice(row.created_by ?? null);
    const bucket = owner ?? managerSub;
    redeemedByOwner.set(
      bucket,
      (redeemedByOwner.get(bucket) ?? 0) + Number(row.amount_usd ?? 0),
    );
  }

  const rows: AgentCreditBreakdownRow[] = officeUsers.map((u) => {
    const accruedUsd = round2(
      creditAccrued(reservationsByOwner.get(u.id) ?? [], creditPerTicket),
    );
    const redeemedUsd = round2(redeemedByOwner.get(u.id) ?? 0);
    return {
      sub: u.id,
      name: u.display_name || u.email,
      accruedUsd,
      redeemedUsd,
      balanceUsd: Math.max(0, round2(accruedUsd - redeemedUsd)),
    };
  });

  return rows.sort((a, b) => b.balanceUsd - a.balanceUsd);
}

/** One voucher-settled order in the agent's settlement view. */
export interface VoucherSettlementRow {
  id: number;
  created_at: string;
  status: string;
  amount_usd: number;
  /** Days since the order was placed - the age the buckets are cut on. */
  age_days: number;
  /** Voucher lifecycle (backoffice-set): sent → received → collected; null = not sent yet. */
  voucher_state: "sent" | "received" | "collected" | null;
}

/**
 * The doc's "התחשבנות מולנו" buckets over voucher-settled orders.
 *
 * A voucher order is created WITHOUT a card charge and waits for the voucher
 * to be collected - so "collected" is simply the order reaching Paid, and the
 * open ones age from the day they were placed. 30 days is the collection
 * window the buckets are cut on.
 */
export interface VoucherSettlement {
  /** Open voucher orders inside the 30-day window - due for collection soon. */
  dueSoonCount: number;
  dueSoonUsd: number;
  /** Open voucher orders past 30 days - collection is overdue. */
  overdueCount: number;
  overdueUsd: number;
  /** Voucher orders already collected (Paid). */
  settledCount: number;
  settledUsd: number;
  /** The open rows, oldest first, for the detail table. */
  openRows: VoucherSettlementRow[];
}

const VOUCHER_COLLECTION_WINDOW_DAYS = 30;

/** Voucher-settlement aging for the signed-in agent. Empty for influencers -
 *  the voucher settlement method is an agent-only flow. */
export async function getMyVoucherSettlement(): Promise<VoucherSettlement> {
  const session = await requireCreditAccess();
  const empty: VoucherSettlement = {
    dueSoonCount: 0,
    dueSoonUsd: 0,
    overdueCount: 0,
    overdueUsd: 0,
    settledCount: 0,
    settledUsd: 0,
    openRows: [],
  };
  if (session.role === "affiliate") return empty;
  // Voucher settlement is OFFICE money (spec §5), unlike credit which is now
  // per-agent (QA wave 2, 20.08) - restrict to office_manager or a solo
  // office; a non-solo agent gets the same empty view as an affiliate.
  if (session.role === "agent") {
    const scope = await resolvePortalScope(session);
    if (!scope.soloOffice) return empty;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data, error } = await (supabase as any)
    .from("reservations")
    .select("id,created_at,status,user_shown_price,voucher_state")
    .eq("aff_partner_tracking_code", session.partner_code)
    .eq("partner_settlement_method", "voucher")
    .order("created_at", { ascending: true });
  // Migration race: voucher_state may not exist yet - retry without it.
  if (error && error.code === "42703") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data, error } = await (supabase as any)
      .from("reservations")
      .select("id,created_at,status,user_shown_price")
      .eq("aff_partner_tracking_code", session.partner_code)
      .eq("partner_settlement_method", "voucher")
      .order("created_at", { ascending: true }));
  }
  if (error) {
    console.error("getMyVoucherSettlement:", JSON.stringify(error));
    return empty;
  }

  const rows = (data ?? []) as {
    id: number;
    created_at: string;
    status: string | null;
    user_shown_price: number | null;
    voucher_state?: "sent" | "received" | "collected" | null;
  }[];

  const now = Date.now();
  const result: VoucherSettlement = { ...empty, openRows: [] };
  for (const row of rows) {
    const amount = Number(row.user_shown_price ?? 0);
    const createdMs = Date.parse(row.created_at);
    const ageDays = Number.isFinite(createdMs)
      ? Math.floor((now - createdMs) / 86_400_000)
      : 0;
    if (row.status === PAID_STATUS) {
      result.settledCount += 1;
      result.settledUsd = round2(result.settledUsd + amount);
      continue;
    }
    // Cancelled/Lost voucher orders owe nothing and age nothing.
    if (row.status === "Cancelled" || row.status === "Lost") continue;
    if (ageDays > VOUCHER_COLLECTION_WINDOW_DAYS) {
      result.overdueCount += 1;
      result.overdueUsd = round2(result.overdueUsd + amount);
    } else {
      result.dueSoonCount += 1;
      result.dueSoonUsd = round2(result.dueSoonUsd + amount);
    }
    result.openRows.push({
      id: row.id,
      created_at: row.created_at,
      status: row.status ?? "Pending",
      amount_usd: round2(amount),
      age_days: ageDays,
      voucher_state: row.voucher_state ?? null,
    });
  }
  return result;
}

/** Any partner's credit, for the staff performance screen. */
export async function getPartnerCredit(
  trackingCode: string,
): Promise<PartnerCredit> {
  await requireStaff();
  return loadCredit(trackingCode);
}

export type ConvertResult =
  | { ok: true; code: string; amountUsd: number }
  | { ok: false; error: string };

export interface ConvertOptions {
  /** Defaults to the whole balance. */
  amountUsd?: number | null;
  /** The partner's own name for the coupon. Generated when blank. */
  code?: string | null;
}

/** Coupon codes are typed by customers - no 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/;
const MIN_CONVERT_USD = 1;

function generateCouponCode(trackingCode: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(
    bytes,
    (b) => CODE_ALPHABET[b % CODE_ALPHABET.length],
  ).join("");
  const prefix = trackingCode
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();
  return `${prefix || "PARTNER"}-${suffix}`;
}

/** Normalise a partner-chosen name into a usable coupon code. */
function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

/**
 * Only the partner converts their own credit, so the messages returned here are
 * shown as-is in the Hebrew portal.
 */
export async function convertCreditToCoupon(
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const session = await requireCreditAccess();
  const scope = await creditScopeForSession(session);
  return convertFor(session.partner_code, session.sub, options, scope);
}

/**
 * Insert the coupon switched off. A generated code retries on collision; a code
 * the partner chose is reported back instead, so they can pick another rather
 * than silently getting a different one.
 *
 * `createdBy` stamps who converted the credit (QA wave 2, 20.08 - per-agent
 * coupon lists in getPortalCoupons key off it; redemption bucketing does NOT
 * - that keys off partner_credit_redemptions.created_by instead, stamped
 * separately on the ledger insert in convertFor below). A not-yet-migrated
 * `created_by` retries the SAME code without it, so a conversion still works
 * before the migration lands - it just isn't attributable in the coupon list
 * yet.
 */
async function insertCoupon(
  firstCode: string,
  amountUsd: number,
  trackingCode: string,
  custom: boolean,
  createdBy: string | null,
): Promise<
  { ok: true; id: number; code: string } | { ok: false; error: string }
> {
  let code = firstCode;
  let includeCreatedBy = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload: Record<string, unknown> = {
      code,
      discount_type: "fixed",
      discount_value: amountUsd,
      max_uses: 1,
      is_active: false,
      partner_tracking_code: trackingCode,
    };
    if (includeCreatedBy && createdBy) payload.created_by = createdBy;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("coupons")
      .insert(payload)
      .select("id")
      .single();

    if (!error) return { ok: true, id: (data as { id: number }).id, code };

    const errorCode = (error as { code?: string }).code;
    if (errorCode === "42703" && includeCreatedBy) {
      console.warn(
        "convertCreditToCoupon: coupons.created_by not migrated yet - inserting without it",
      );
      includeCreatedBy = false;
      attempt -= 1; // retry the SAME code, not a new collision-retry attempt
      continue;
    }
    // 23505 = unique violation. Anything else is not worth retrying.
    if (errorCode !== "23505") {
      console.error("convertCreditToCoupon coupon:", JSON.stringify(error));
      return { ok: false, error: "לא הצלחנו ליצור את הקופון. נסו שוב." };
    }
    if (custom) {
      return { ok: false, error: `השם "${code}" כבר תפוס. בחרו שם אחר.` };
    }
    code = generateCouponCode(trackingCode);
  }
  return { ok: false, error: "לא הצלחנו ליצור את הקופון. נסו שוב." };
}

async function convertFor(
  trackingCode: string,
  actorId: string | null,
  options: ConvertOptions,
  scope?: CreditScope,
): Promise<ConvertResult> {
  const credit = await loadCredit(trackingCode, scope);

  const requested =
    options.amountUsd == null ? credit.balanceUsd : Number(options.amountUsd);
  if (!Number.isFinite(requested)) {
    return { ok: false, error: "יש להזין סכום תקין" };
  }
  const amountUsd = round2(requested);

  if (credit.balanceUsd < MIN_CONVERT_USD) {
    return {
      ok: false,
      error: `צריך לפחות $${MIN_CONVERT_USD} בצבירה כדי להפיק קופון`,
    };
  }
  if (amountUsd < MIN_CONVERT_USD) {
    return { ok: false, error: `הקופון המינימלי הוא $${MIN_CONVERT_USD}` };
  }
  if (amountUsd > credit.balanceUsd) {
    return { ok: false, error: `יש לכם רק $${credit.balanceUsd} להמרה` };
  }

  const chosenName = options.code?.trim() ?? "";
  const custom = chosenName.length > 0;
  let code: string;
  if (custom) {
    code = normaliseCode(chosenName);
    if (!CODE_PATTERN.test(code)) {
      return {
        ok: false,
        error:
          "שם הקופון צריך 3-32 אותיות באנגלית, ספרות או מקפים, ולא להתחיל או להסתיים במקף",
      };
    }
  } else {
    code = generateCouponCode(trackingCode);
  }

  // Created switched OFF: until the ledger records it, this coupon must not be
  // spendable, because the balance still offers the same credit.
  const coupon = await insertCoupon(code, amountUsd, trackingCode, custom, actorId);
  if (!coupon.ok) return { ok: false, error: coupon.error };
  const { id: couponId, code: finalCode } = coupon;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ledgerData, error: ledgerError } = await (supabase as any)
    .from("partner_credit_redemptions")
    .insert({
      partner_tracking_code: trackingCode,
      amount_usd: amountUsd,
      coupon_id: couponId,
      coupon_code: finalCode,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (ledgerError) {
    console.error("convertCreditToCoupon ledger:", JSON.stringify(ledgerError));
    // The coupon was never activated, so it is already worthless. Remove it so
    // the name is free again.
    await supabase.from("coupons").delete().eq("id", couponId);
    return { ok: false, error: "לא הצלחנו לרשום את ההמרה. נסו שוב." };
  }

  const ledgerId = (ledgerData as { id: number }).id;

  // No transaction is available here, so check after the fact. Compare against
  // everything redeemed BEFORE this row, not "does an older row exist" - every
  // partner who has converted once has older rows, and testing for their mere
  // presence would make a legitimate conversion undo itself.
  //
  // The bucketing above now keys on partner_credit_redemptions.created_by,
  // which the ledger insert above always stamps regardless of the
  // coupons.created_by migration state - so this re-read sees the
  // just-inserted row and buckets it correctly even mid-deploy, closing the
  // race this check exists to catch.
  //
  // If this read fails - including the redemptions re-read itself erroring -
  // the credit is already committed against a coupon that is still switched
  // off and we cannot prove the balance still holds. Fail CLOSED: undo both
  // rather than risk a double-spend.
  let after: PartnerCredit;
  try {
    after = await loadCredit(trackingCode, scope);
  } catch (error) {
    console.error("convertCreditToCoupon post-check:", error);
    await supabase
      .from("partner_credit_redemptions")
      .delete()
      .eq("id", ledgerId);
    await supabase.from("coupons").delete().eq("id", couponId);
    return { ok: false, error: "יתרה השתנתה - נסו שוב" };
  }

  const available = round2(after.accruedUsd + after.returnedUsd);
  const priorRedeemed = after.history
    .filter((row) => row.id < ledgerId)
    .reduce((sum, row) => sum + Number(row.amount_usd ?? 0), 0);

  if (round2(priorRedeemed + amountUsd) > available + 0.001) {
    console.error(
      `convertCreditToCoupon: lost a race for ${trackingCode} - prior ${priorRedeemed} + ${amountUsd} > available ${available}. Backing out ledger ${ledgerId} / coupon ${finalCode}.`,
    );
    await supabase
      .from("partner_credit_redemptions")
      .delete()
      .eq("id", ledgerId);
    await supabase.from("coupons").delete().eq("id", couponId);
    return {
      ok: false,
      error: "הצבירה הזו הומרה הרגע. רעננו כדי לראות את היתרה.",
    };
  }

  // Safe to hand over now that the credit is recorded as spent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: activateError } = await (supabase as any)
    .from("coupons")
    .update({ is_active: true })
    .eq("id", couponId);
  if (activateError) {
    console.error(
      `convertCreditToCoupon: coupon ${finalCode} recorded but not activated:`,
      JSON.stringify(activateError),
    );
    return {
      ok: false,
      error: `הקופון ${finalCode} נוצר אך לא הופעל. פנו אלינו.`,
    };
  }

  await logAudit({
    action: "create",
    entityType: "coupon",
    entityId: String(couponId),
    metadata: {
      partner_credit_conversion: true,
      partner_tracking_code: trackingCode,
      amount_usd: amountUsd,
      code: finalCode,
      named_by_partner: custom,
    },
  });

  return { ok: true, code: finalCode, amountUsd };
}
