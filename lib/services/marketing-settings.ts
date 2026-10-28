/** marketing_settings as one typed object (a key never saved reads its default). Session-free; the callers guard.
 *  THROWS on a read error - a default threshold would quietly stand in for the one staff set. */
import { mdb } from "@/lib/services/marketing-db";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type MarketingSettings } from "@/types/marketing.types";

export async function readMarketingSettings(): Promise<MarketingSettings> {
  const { data, error } = await mdb.from("marketing_settings").select("key, value");
  if (error) throw new Error(`marketing_settings read: ${error.message}`);
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const row of (data ?? []) as { key: keyof MarketingSettings; value: unknown }[]) {
    if (MARKETING_SETTING_KEYS.includes(row.key)) (out as unknown as Record<string, unknown>)[row.key] = row.value;
  }
  return out;
}
