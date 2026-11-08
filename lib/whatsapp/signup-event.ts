/**
 * Meta's Embedded Signup posts its progress to the opener window (sessionInfoVersion 3) - pure and client-safe
 * (selftest: scripts/whatsapp-selftest.ts). Two events mean the signup finished:
 *
 *   FINISH                                   a new number: data = { phone_number_id, waba_id, business_id }
 *   FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING  a number that stays in the WhatsApp Business app (coexistence):
 *                                            data = { waba_id } ONLY - the server reads the number off the account
 *
 * `FINISH_ONLY_WABA` (an account made with no number) is not a finish: there is nothing to connect.
 * Until 08.11.2026 the card listened for `FINISH` alone, so a coexistence signup would have converted the number at
 * Meta while the card stopped at "no ids" - no webhook subscription, no account row, no history request (24 h, once).
 */
export const SIGNUP_FINISH_EVENTS = ["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"] as const;

export type SignupFinish = { wabaId: string | null; phoneNumberId: string | null };

const metaId = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return /^\d{6,20}$/.test(t) ? t : null;
};

/** The ids a finish event carries, or null when the event is not a finish. */
export function signupFinishOf(event: unknown, data: unknown): SignupFinish | null {
  if (typeof event !== "string" || !(SIGNUP_FINISH_EVENTS as readonly string[]).includes(event)) return null;
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return { wabaId: metaId(d.waba_id), phoneNumberId: metaId(d.phone_number_id) };
}
