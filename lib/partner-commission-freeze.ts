import { supabase } from "@/lib/supabase-server";

/**
 * Freeze the OLD commission terms onto a partner's existing reservations at
 * the moment the rate changes, so the new rate only applies from now on
 * (production bug 2026-08-11: changing an affiliate's commission repriced the
 * whole "עמלה לתשלום" figure retroactively).
 *
 * Only rows with NO snapshot yet are stamped - a reservation frozen by an
 * earlier rate change keeps the terms it was earned under, and anything
 * created after this call has commission_rate NULL, i.e. the partner's new
 * current rate. Server-only (service-role client); called by every writer of
 * `partners.commission` / `commission_type` BEFORE the partner row updates,
 * and the update is aborted if stamping fails - failing open would silently
 * reintroduce the retro bug.
 */
export async function freezeCommissionOnExistingReservations(args: {
  trackingCode: string;
  previousType: string | null;
  previousRate: number | null;
  nextType: string;
  nextRate: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { trackingCode, previousType, previousRate, nextType, nextRate } = args;

  // No old deal to preserve: a partner whose rate was never set earned 0 on
  // those rows anyway, and freezing 0 forever would block the common "terms
  // finally agreed" first-time setup from paying the back-book.
  if (previousRate == null || !Number.isFinite(Number(previousRate))) {
    return { ok: true };
  }

  // Unchanged terms (e.g. the admin form saved with only the name edited)
  // must not freeze anything - freezing is meaningful only on a real change.
  const prevType = previousType ?? "fixed_per_ticket";
  if (prevType === nextType && Number(previousRate) === Number(nextRate)) {
    return { ok: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("reservations")
    .update({
      commission_type: prevType,
      commission_rate: Number(previousRate),
    })
    .eq("aff_partner_tracking_code", trackingCode)
    .is("commission_rate", null);
  if (error) {
    console.error(
      "freezeCommissionOnExistingReservations:",
      JSON.stringify(error),
    );
    return {
      ok: false,
      error:
        "Could not freeze the current terms on existing reservations - the rate was NOT changed",
    };
  }
  return { ok: true };
}
