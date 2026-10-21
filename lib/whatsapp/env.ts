/**
 * Which env values carry a company's WhatsApp credentials - pure (selftest: scripts/whatsapp-selftest.ts).
 *
 *   NEXT_SECRET_WHATSAPP_TOKEN_<SLUG>   a company's own permanent system-user token (optional)
 *   NEXT_SECRET_WHATSAPP_TOKEN          the shared token, used when the company has none of its own
 *   NEXT_SECRET_WHATSAPP_PHONE_ID_<SLUG> the company's phone-number id (digits)
 *
 * <SLUG> = the company slug upper-cased with every non-alphanumeric as "_": mega-family -> MEGA_FAMILY.
 * Tokens live here and in Vercel only - never in a table, never on a screen.
 */
type Env = Record<string, string | undefined>;

const slugKey = (slug: string): string => slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** The env name of a company's phone-number id. */
export const envKey = (slug: string): string => `NEXT_SECRET_WHATSAPP_PHONE_ID_${slugKey(slug)}`;

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** The sending token for a company: its own first, else the shared one; null when neither is set. */
export function tokenFor(slug: string, env: Env = process.env): string | null {
  return clean(env[`NEXT_SECRET_WHATSAPP_TOKEN_${slugKey(slug)}`]) ?? clean(env.NEXT_SECRET_WHATSAPP_TOKEN);
}

/** The company's phone-number id from env, when it is one (6-20 digits). */
export function phoneIdFor(slug: string, env: Env = process.env): string | null {
  const v = clean(env[envKey(slug)]);
  return v && /^\d{6,20}$/.test(v) ? v : null;
}
