"use server";

import { requireStaff } from "@/lib/auth/guards";
import { diffChanges, logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { isMissingRelation } from "@/lib/services/marketing-db";
import { revalidateItinerary } from "@/lib/revalidate-itinerary";
import {
  DEFAULT_ITINERARY_SETTINGS,
  itineraryErrorsText,
  itineraryRows,
  parseItinerarySettingRows,
  validateItinerarySettings,
  type ItinerarySettingsRead,
  type SaveItinerarySettingsResult,
} from "@/lib/itinerary/settings";

/**
 * "Build Your Euro Trip" - the settings screen's reads and writes (Templates > Euro Trip > Settings).
 * Staff run it (requireStaff, the default guard of every dashboard mutation). The rules live in
 * lib/itinerary/settings.ts (pure, scripts/itinerary-settings-selftest.ts); the table is the key / value
 * `itinerary_settings` (migration 20261021193309) that myt-main reads.
 *
 * Neither function throws: the table does not exist until that migration is pushed, and the screen has to
 * open on the defaults and explain, not crash.
 */

// The ONE untyped boundary for the table: types/database.types.ts has no `itinerary_settings` until
// `npm run db:types` is rerun after the migration is applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const idb = supabase as any;

const TABLE = "itinerary_settings";

const NO_ACCESS = "אין הרשאה - התחברו מחדש ונסו שוב";
const TABLE_MISSING = "הטבלה itinerary_settings עדיין לא קיימת - ההגדרות נשמרות אחרי פריסת המיגרציה";

type RowsRead =
  | { kind: "rows"; rows: { key: string; value: unknown }[] }
  | { kind: "missing" }
  | { kind: "error"; message: string };

async function readRows(): Promise<RowsRead> {
  const { data, error } = await idb.from(TABLE).select("key, value");
  if (error) {
    if (isMissingRelation(error)) return { kind: "missing" };
    console.error("itinerary_settings read:", JSON.stringify(error));
    return { kind: "error", message: error.message ?? "שגיאה בקריאת ההגדרות" };
  }
  return { kind: "rows", rows: (data ?? []) as { key: string; value: unknown }[] };
}

/**
 * What the site would use right now: the saved rows over the defaults. A table that is not there yet reads as
 * the defaults with `status: "table_missing"`; any other failure reads as `status: "error"` (the defaults then
 * are NOT what is saved, and the screen says so).
 */
export async function readItinerarySettings(): Promise<ItinerarySettingsRead> {
  try {
    await requireStaff();
  } catch {
    return { status: "error", settings: DEFAULT_ITINERARY_SETTINGS, message: NO_ACCESS };
  }
  try {
    const read = await readRows();
    if (read.kind === "missing") return { status: "table_missing", settings: DEFAULT_ITINERARY_SETTINGS };
    if (read.kind === "error") return { status: "error", settings: DEFAULT_ITINERARY_SETTINGS, message: read.message };
    return { status: "ok", settings: parseItinerarySettingRows(read.rows), saved: read.rows.length > 0 };
  } catch (e) {
    console.error("readItinerarySettings failed:", e);
    return { status: "error", settings: DEFAULT_ITINERARY_SETTINGS, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Validates the whole form, writes all eleven keys in ONE upsert (jsonb numbers / booleans), audits the
 * change, then tells the site to refresh. The write is what counts: a refresh that fails comes back as
 * `{ ok: true, warning }`, never an error - the site picks the change up on its own cache expiry.
 */
export async function saveItinerarySettings(form: unknown): Promise<SaveItinerarySettingsResult> {
  let session;
  try {
    session = await requireStaff();
  } catch {
    return { error: NO_ACCESS };
  }

  try {
    const checked = validateItinerarySettings(form);
    if (!checked.ok) return { error: itineraryErrorsText(checked.errors), fieldErrors: checked.errors };

    // The existing values, for the audit trail - and the missing-table answer comes before any write.
    const before = await readRows();
    if (before.kind === "missing") return { error: TABLE_MISSING };
    if (before.kind === "error") return { error: `קריאת ההגדרות הקיימות נכשלה: ${before.message}` };

    const rows = itineraryRows(checked.settings);
    const now = new Date().toISOString();
    const { error } = await idb
      .from(TABLE)
      .upsert(rows.map((r) => ({ key: r.key, value: r.value, updated_by: session.sub, updated_at: now })), { onConflict: "key" });
    if (error) {
      if (isMissingRelation(error)) return { error: TABLE_MISSING };
      console.error("itinerary_settings upsert:", JSON.stringify(error));
      return { error: `השמירה נכשלה: ${error.message ?? "שגיאה"}` };
    }

    const beforeByKey = itineraryRows(parseItinerarySettingRows(before.rows));
    await logAudit({
      action: "itinerary.settings",
      entityType: "itinerary_settings",
      changes: diffChanges(
        Object.fromEntries(beforeByKey.map((r) => [r.key, r.value])),
        Object.fromEntries(rows.map((r) => [r.key, r.value])),
      ),
      actor: { id: session.sub, email: session.email, role: session.role },
    });

    const refreshed = await revalidateItinerary();
    if (!refreshed.ok) {
      return {
        ok: true,
        warning: `ההגדרות נשמרו, אבל לא הצלחנו לרענן את האתר (${refreshed.reason}). השינוי יגיע לאתר כשהמטמון שלו יפוג.`,
      };
    }
    return { ok: true };
  } catch (e) {
    console.error("saveItinerarySettings failed:", e);
    return { error: `השמירה נכשלה: ${e instanceof Error ? e.message : String(e)}` };
  }
}
