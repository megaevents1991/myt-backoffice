"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import {
  PAID_STATUS,
  commissionForReservation,
  round2,
  type CommissionTerms,
} from "@/lib/partner-commission";
import {
  fundedCouponCodesFor,
  quoteUpliftsFor,
} from "@/lib/actions/portal-coupon-actions";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { CommissionType } from "@/types/partner.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/**
 * Manual billing marks for partner commission.
 *
 * The monthly cron stamps `billed_at` when a report goes out through the
 * system - but some reports go out by hand (July 2026 went out that way).
 * Those reservations stay "pending" on every surface until someone records
 * the fact, which is what these actions are for.
 */

export interface UnbilledCommissionRow {
  id: number;
  created_at: string;
  customer: string | null;
  event: string | null;
  commissionUsd: number;
}

type Row = {
  id: number;
  created_at: string;
  main_contact_first_name: string | null;
  main_contact_last_name: string | null;
  status: string | null;
  user_shown_price: number | null;
  event_order_info: ReservationEventOrderInfo | null;
  coupon_code: string | null;
  coupon_discount_usd: number | null;
  quote_id: number | null;
  partner_settlement_method: string | null;
  commission_type: string | null;
  commission_rate: number | null;
};

/** Paid, commission-earning reservations not yet in any report (manual or cron). */
export async function getUnbilledPaidReservations(
  trackingCode: string,
): Promise<UnbilledCommissionRow[]> {
  await requireStaff();

  const [partnerRes, rowsRes, fundedCodes, quoteUplifts] = await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", trackingCode)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_order_info,coupon_code,coupon_discount_usd,quote_id,partner_settlement_method,commission_type,commission_rate",
      )
      .eq("aff_partner_tracking_code", trackingCode)
      .eq("status", PAID_STATUS)
      .is("billed_at", null)
      .order("created_at", { ascending: true }),
    fundedCouponCodesFor(trackingCode),
    quoteUpliftsFor(trackingCode),
  ]);
  if (partnerRes.error) {
    console.error(JSON.stringify(partnerRes.error));
    throw partnerRes.error;
  }
  if (rowsRes.error) {
    console.error(JSON.stringify(rowsRes.error));
    throw rowsRes.error;
  }

  const partner = partnerRes.data as {
    commission: number;
    commission_type: CommissionType | null;
  } | null;
  const terms: CommissionTerms = {
    // Same defaults as the cron and the portal - the three must agree.
    type: partner?.commission_type ?? "fixed_per_ticket",
    rate: partner?.commission ?? 0,
    fundedCouponCodes: fundedCodes,
    upliftByReservationId: quoteUplifts,
  };

  return ((rowsRes.data ?? []) as unknown as Row[])
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      customer:
        [row.main_contact_first_name, row.main_contact_last_name]
          .filter(Boolean)
          .join(" ") || null,
      event:
        normalizeReservationEventOrderInfo(row.event_order_info)[0]?.name ??
        null,
      commissionUsd: round2(commissionForReservation(row, terms)),
    }))
    .filter((row) => row.commissionUsd > 0);
}

/**
 * Record that these reservations were already reported/paid outside the cron.
 * Only rows still unstamped are touched - an existing `billed_at` (cron or
 * cutoff backfill) is never overwritten. Returns how many rows were stamped.
 */
export async function markReservationsBilled(
  trackingCode: string,
  ids: number[],
): Promise<number> {
  await requireStaff();
  const cleanIds = ids.filter((id) => Number.isInteger(id));
  if (cleanIds.length === 0) return 0;

  // billed_at isn't in the generated DB types yet - same cast the cron uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reservations")
    .update({ billed_at: new Date().toISOString() })
    .in("id", cleanIds)
    .eq("aff_partner_tracking_code", trackingCode)
    .eq("status", PAID_STATUS)
    .is("billed_at", null)
    .select("id");
  if (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  const stamped = (data ?? []).length;
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: cleanIds[0],
    metadata: {
      op: "manual_mark_billed",
      tracking_code: trackingCode,
      requested: cleanIds.length,
      stamped,
      ids: cleanIds,
    },
  });

  revalidatePath(`/partners/${trackingCode}/view`);
  return stamped;
}
