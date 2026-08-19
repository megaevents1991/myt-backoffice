"use server";

import { requireCreditAccess, requireStaff } from "@/lib/auth/guards";
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

async function loadCredit(trackingCode: string): Promise<PartnerCredit> {
  const [partnerResult, reservationsResult, redemptionsResult] =
    await Promise.all([
      supabase
        .from("partners")
        .select("credit_per_ticket,credit_accrual_start")
        .eq("partner_tracking_code", trackingCode)
        .maybeSingle(),
      supabase
        .from("reservations")
        .select("status,event_order_info,created_at,billed_at")
        .eq("aff_partner_tracking_code", trackingCode),
      supabase
        .from("partner_credit_redemptions")
        .select("id,amount_usd,coupon_code,created_at")
        .eq("partner_tracking_code", trackingCode)
        .order("created_at", { ascending: false }),
    ]);

  if (partnerResult.error) throw partnerResult.error;
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
  const reservations = accrualStart
    ? allReservations.filter(
        (r) =>
          (r.created_at ?? "") >= accrualStart ||
          !wasSettledAtCutoff(r.billed_at),
      )
    : allReservations;
  const rawHistory = (redemptionsResult.data ?? []) as unknown as LedgerRow[];

  // Anyone can redeem a partner's coupon, so usage is NOT scoped to the
  // partner's own attributed reservations - it is keyed on the coupon codes.
  // The RPC folds case the same way the count_coupon_paid_use trigger does,
  // because `reservations.coupon_code` stores whatever the customer typed; a
  // case-sensitive match would miss a lower-case entry and the partner would
  // simply lose the unspent remainder.
  const codes = rawHistory
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
    rawHistory,
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

/** The signed-in partner's own credit. */
export async function getMyCredit(): Promise<PartnerCredit> {
  const session = await requireCreditAccess();
  return loadCredit(session.partner_code);
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
  return convertFor(session.partner_code, session.sub, options);
}

/**
 * Insert the coupon switched off. A generated code retries on collision; a code
 * the partner chose is reported back instead, so they can pick another rather
 * than silently getting a different one.
 */
async function insertCoupon(
  firstCode: string,
  amountUsd: number,
  trackingCode: string,
  custom: boolean,
): Promise<
  { ok: true; id: number; code: string } | { ok: false; error: string }
> {
  let code = firstCode;
  for (let attempt = 0; attempt < 3; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("coupons")
      .insert({
        code,
        discount_type: "fixed",
        discount_value: amountUsd,
        max_uses: 1,
        is_active: false,
        partner_tracking_code: trackingCode,
      })
      .select("id")
      .single();

    if (!error) return { ok: true, id: (data as { id: number }).id, code };

    // 23505 = unique violation. Anything else is not worth retrying.
    if ((error as { code?: string }).code !== "23505") {
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
): Promise<ConvertResult> {
  const credit = await loadCredit(trackingCode);

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
  const coupon = await insertCoupon(code, amountUsd, trackingCode, custom);
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
  // If this read fails the credit is already committed against a coupon that is
  // still switched off, so undo both rather than leaving the partner short.
  let after: PartnerCredit;
  try {
    after = await loadCredit(trackingCode);
  } catch (error) {
    console.error("convertCreditToCoupon post-check:", error);
    await supabase
      .from("partner_credit_redemptions")
      .delete()
      .eq("id", ledgerId);
    await supabase.from("coupons").delete().eq("id", couponId);
    return { ok: false, error: "לא הצלחנו להשלים את ההמרה. נסו שוב." };
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
