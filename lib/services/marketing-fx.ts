/** The USD -> ILS rate the marketing reads fall back on. Session-free; the callers guard. */
import { mdb } from "@/lib/services/marketing-db";

/** USD -> ILS for an order with no stored rate (and a non-ILS spend row): 1 / the newest `fx_rate` the sync wrote
 *  (always a live rate - the sync writes no spend on the fallback rate). The rate service itself is not called here:
 *  its module throws at load without the supplier env (see marketing-sync.ts). Throws when none was ever written. */
export async function currentUsdIls(): Promise<number> {
  const { data, error } = await mdb.from("ad_spend_daily").select("fx_rate").gt("fx_rate", 0).order("synced_at", { ascending: false }).limit(1);
  if (error) throw new Error(`ad_spend_daily rate read: ${error.message}`);
  const fx = Number((data as { fx_rate: number }[] | null)?.[0]?.fx_rate);
  if (!(fx > 0)) throw new Error("No USD/ILS rate stored yet - run the marketing sync once");
  return Math.round((1 / fx) * 10_000) / 10_000;
}
