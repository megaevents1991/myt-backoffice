/**
 * The marketing settings check (Settings tab -> saveMarketingSettings). Pure; scripts/marketing-settings-selftest.ts.
 * Every key the patch carries is validated BEFORE anything is read or written; a key it does not carry is left as
 * it is; an unknown key is ignored. One bad value refuses the whole save.
 */
import { MARKETING_SETTING_KEYS, type MarketingSettings } from "@/types/marketing.types";

type NumKey = Exclude<keyof MarketingSettings, "alert_emails">;

/** The accepted range of each number (inclusive). `budget_bleed_days` is a whole number of days. */
export const SETTING_BOUNDS: Record<NumKey, { min: number; max: number; integer?: boolean }> = {
  processing_fee_pct: { min: 0, max: 100 },
  monthly_profit_target_usd: { min: 0, max: 100_000_000 },
  budget_bleed_ils: { min: 0, max: 1_000_000 },
  budget_bleed_days: { min: 1, max: 60, integer: true },
  viral_pct: { min: 50, max: 1000 },
};

export const ALERT_EMAILS_MAX = 10;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type SettingsRow = { key: keyof MarketingSettings; value: number | string[] };

export function validateSettingsPatch(patch: unknown): { ok: true; rows: SettingsRow[] } | { ok: false; error: string } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "settings must be an object" };
  const p = patch as Record<string, unknown>;
  const rows: SettingsRow[] = [];
  for (const key of MARKETING_SETTING_KEYS) {
    if (!(key in p)) continue;
    const v = p[key];
    if (key === "alert_emails") {
      if (!Array.isArray(v) || !v.every((e) => typeof e === "string")) return { ok: false, error: "alert_emails must be a list of addresses" };
      // Trimmed, blanks dropped, deduped case-insensitively (the first spelling is kept).
      const seen = new Set<string>();
      const emails: string[] = [];
      for (const raw of v as string[]) {
        const e = raw.trim();
        if (!e || seen.has(e.toLowerCase())) continue;
        if (!EMAIL.test(e)) return { ok: false, error: `alert_emails: "${e}" is not an email address` };
        seen.add(e.toLowerCase());
        emails.push(e);
      }
      if (emails.length > ALERT_EMAILS_MAX) return { ok: false, error: `alert_emails: at most ${ALERT_EMAILS_MAX} addresses` };
      rows.push({ key, value: emails });
      continue;
    }
    const b = SETTING_BOUNDS[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < b.min || v > b.max || (b.integer && !Number.isInteger(v))) {
      return { ok: false, error: `${key} must be ${b.integer ? "a whole number" : "a number"} from ${b.min} to ${b.max.toLocaleString("en-US")}` };
    }
    rows.push({ key, value: v });
  }
  return { ok: true, rows };
}
