// MEGA CLUB settings validation (spec §10). Pure. The site reads the same keys with its own lenient parser
// (myt-main lib/club/rules.ts parseClubSettings).
import type { ClubSettings } from "@/lib/club/types";

export const CLUB_AMOUNT_MIN = 1; // coupons has CHECK (discount_value > 0); "no price" is the off switch
export const CLUB_AMOUNT_MAX = 500;
export const CLUB_DELAY_MIN = 5;
export const CLUB_DELAY_MAX = 120;

export const DEFAULT_CLUB_SETTINGS: ClubSettings = { enabled: true, discount_per_traveler_usd: 50, popup_delay_seconds: 22 };

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function validateClubSettings(input: unknown): { ok: true; value: ClubSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Settings are missing." };
  const o = input as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return { ok: false, error: "The on / off switch must be on or off." };
  if (!intIn(o.discount_per_traveler_usd, CLUB_AMOUNT_MIN, CLUB_AMOUNT_MAX)) {
    return { ok: false, error: `The amount per traveler is a whole number of dollars, ${CLUB_AMOUNT_MIN} to ${CLUB_AMOUNT_MAX}.` };
  }
  if (!intIn(o.popup_delay_seconds, CLUB_DELAY_MIN, CLUB_DELAY_MAX)) {
    return { ok: false, error: `The popup delay is a whole number of seconds, ${CLUB_DELAY_MIN} to ${CLUB_DELAY_MAX}.` };
  }
  return {
    ok: true,
    value: { enabled: o.enabled, discount_per_traveler_usd: o.discount_per_traveler_usd, popup_delay_seconds: o.popup_delay_seconds },
  };
}
