"use server";

/**
 * Pricing tab on /tasks (Task 15, 2026-09-16): every open pricing gap - red price
 * lights and frozen base-price changes - in one list, with Task / Fix / Handled
 * buttons like the Creative gaps tab. Staff, not admin (Dor, 16.09): unlike
 * /price-light, this tab is visible to the whole team, so it can never call the
 * admin-gated actions in price-light-actions.ts / base-price-log-actions.ts
 * directly - it goes through requireStaff() here and the session-free services in
 * lib/services/gap-resolution.ts and lib/services/price-light-decisions.ts.
 */
import { requireStaff } from "@/lib/auth/guards";
import { supabaseTyped } from "@/lib/supabase-server";
import { generatorFor, type RuleCandidate } from "@/lib/services/task-rules";
import { createTask } from "@/lib/actions/task-actions";
import { openPriceLightTask as insertPriceLightTask } from "@/lib/services/price-light-tasks";
import { listEventMatches } from "@/lib/actions/price-light-actions";
import { recordRepriced } from "@/lib/services/price-light-decisions";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { loadEventForLight } from "@/lib/services/price-light-store";
import { parseGapKey, nextNightlyRun, setSyncLogReviewed, HANDLED_BY_BUTTON_NOTE } from "@/lib/services/gap-resolution";
import { OPEN_TASK_STATUSES, type TaskSourceRef } from "@/types/task.types";
import type { Scope } from "@/types/price-light.types";
import type { PricingGapListResult, PricingGapRow, PricingGapSource } from "@/types/pricing-gap.types";

// Typed against types/database.types.ts (npm run db:types).
const db = supabaseTyped;

type Ok = { ok: true } | { ok: false; error: string };
type TaskResult = { ok: true; taskId: string; existed: boolean } | { ok: false; error: string };

// The generators only put numbers in their Hebrew description text (RuleCandidate
// has no structured amount field) - parsed back out here rather than reaching into
// task-rules internals, so this tab never depends on wording it doesn't own.
const LIGHT_GAP_RE = /פער \$(-?\d+(?:\.\d+)?)/;
const LIGHT_SINCE_RE = /אדום מאז (\d{4}-\d{2}-\d{2})/;
const CHANGE_GAP_RE = /הפרש \$(-?\d+(?:\.\d+)?)/;

function numberFrom(match: RegExpMatchArray | null): number | null {
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function lightRow(candidate: RuleCandidate, openTaskId: string | null): PricingGapRow {
  return {
    key: candidate.key,
    source: "price_light",
    scope: candidate.sourceRef.kind,
    eventId: Number(candidate.sourceRef.row_id),
    eventName: candidate.sourceRef.label,
    gapUsd: numberFrom(candidate.description.match(LIGHT_GAP_RE)),
    since: candidate.description.match(LIGHT_SINCE_RE)?.[1] ?? null,
    fixUrl: candidate.sourceRef.url,
    openTaskId,
  };
}

function changeRow(candidate: RuleCandidate, openTaskId: string | null): PricingGapRow {
  return {
    key: candidate.key,
    source: "price_changes",
    scope: candidate.sourceRef.kind, // always "price_review"
    eventId: Number(candidate.sourceRef.row_id),
    eventName: candidate.sourceRef.label,
    gapUsd: numberFrom(candidate.description.match(CHANGE_GAP_RE)),
    since: null,
    fixUrl: candidate.sourceRef.url,
    openTaskId,
  };
}

/** id lookup alongside openTaskGapKeys()'s keys - a row with an open task links to
 *  it (brief: "שורה שכבר יש לה משימה פתוחה מציגה קישור אליה במקום כפתור"), which
 *  needs the task's actual id, not just a yes/no. */
async function loadOpenTaskIds(source: "price_light" | "price_review"): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("tasks")
    .select("id,source_ref")
    .eq("source", source)
    .is("deleted_at", null)
    .in("status", OPEN_TASK_STATUSES);
  if (error) {
    console.error(`pricing-gaps: open ${source} tasks failed`, JSON.stringify(error));
    return new Map();
  }
  const ids = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; source_ref: TaskSourceRef | null }[]) {
    if (!row.source_ref) continue;
    ids.set(`${row.source_ref.kind}:${row.source_ref.table}:${row.source_ref.row_id}`, row.id);
  }
  return ids;
}

/**
 * Every open pricing gap, from the SAME generators the weekly digest runs
 * (lib/services/task-rules) - "what counts as an open pricing gap" stays defined
 * in one place, never re-split between this screen and the cron. Each generator
 * THROWS when its data cannot load (see RuleGenerator.candidates jsdoc) - controller
 * ruling #2: the two generators are loaded independently (`Promise.allSettled`), so
 * one throwing (today: price_light, until `events.light_red_since` is migrated in
 * this environment) reports itself in `errors` instead of hiding the rows the OTHER
 * generator loaded fine. `ok: false` is reserved for requireStaff()/unexpected
 * failures outside either generator's own try path.
 */
export async function listPricingGaps(): Promise<PricingGapListResult> {
  await requireStaff();
  try {
    const [lightSettled, changeSettled] = await Promise.allSettled([
      generatorFor("price_light").candidates({}),
      generatorFor("price_changes").candidates({}),
    ]);

    const errors: { source: PricingGapSource; error: string }[] = [];
    const rows: PricingGapRow[] = [];

    if (lightSettled.status === "fulfilled") {
      const lightTaskIds = await loadOpenTaskIds("price_light");
      rows.push(...lightSettled.value.map((c) => lightRow(c, lightTaskIds.get(c.key) ?? null)));
    } else {
      console.error("listPricingGaps: price_light failed", lightSettled.reason);
      errors.push({
        source: "price_light",
        error: lightSettled.reason instanceof Error ? lightSettled.reason.message : "טעינת הרמזור נכשלה",
      });
    }

    if (changeSettled.status === "fulfilled") {
      const reviewTaskIds = await loadOpenTaskIds("price_review");
      rows.push(...changeSettled.value.map((c) => changeRow(c, reviewTaskIds.get(c.key) ?? null)));
    } else {
      console.error("listPricingGaps: price_changes failed", changeSettled.reason);
      errors.push({
        source: "price_changes",
        error: changeSettled.reason instanceof Error ? changeSettled.reason.message : "טעינת שינויי המחיר נכשלה",
      });
    }

    return { ok: true, rows, errors };
  } catch (e) {
    console.error("listPricingGaps failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "טעינת הפערים נכשלה" };
  }
}

/** Context for a price_review task - mirrors createTaskFor's prefill in
 *  price-changes-client.tsx exactly, so a task opened from either screen reads the
 *  same. Staff-readable directly (no requireAdmin listSyncLog reuse needed). */
async function priceReviewContext(
  eventId: number,
): Promise<{ label: string; title: string; description: string } | null> {
  const { data: logRows, error: logError } = await db
    .from("base_price_sync_log")
    .select("component,old_price,new_price,live_price,note,created_at")
    .eq("event_id", eventId)
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(1);
  if (logError || !logRows?.length) {
    console.error("pricing-gaps: price_review context failed", JSON.stringify(logError));
    return null;
  }
  const row = logRows[0] as {
    component: string;
    old_price: number | null;
    new_price: number | null;
    live_price: number | null;
    note: string | null;
  };
  const { data: event } = await db.from("events").select("name,date").eq("id", eventId).maybeSingle();
  const label = (event?.name as string | undefined) ?? `#${eventId}`;
  const title = `בדיקת מחיר: ${label} (${row.component})`;
  const description = [
    `$${row.old_price ?? "?"} → $${row.live_price ?? row.new_price ?? "?"}`,
    event?.date ? `תאריך האירוע: ${event.date}` : "",
    row.note ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  return { label, title, description };
}

/**
 * One-select existence check (controller ruling #3): a gap row's key was parsed out of a
 * candidate list computed moments earlier, so the event it points at might already be gone by
 * the time a button is clicked - soft-deleted (`is_deleted`), or a test event nobody should be
 * writing tasks/audit rows for. Both write actions below check this before touching anything.
 */
async function eventIsUsable(eventId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db.from("events").select("id,is_deleted,is_test").eq("id", eventId).maybeSingle();
  if (error) {
    console.error("pricing-gaps: event check failed", JSON.stringify(error));
    return { ok: false, error: "שגיאה בבדיקת האירוע" };
  }
  if (!data || data.is_deleted != null || data.is_test) {
    return { ok: false, error: "האירוע לא נמצא" };
  }
  return { ok: true };
}

/** "משימה": open (or reuse) the task a gap becomes - a price_light red scope opens
 *  the same task openPriceLightTask does on /price-light, a price_changes row opens
 *  a price_review task shaped exactly like price-changes-client.tsx's own
 *  "Create task" button. Both dedupe on an already-open task and return `existed`
 *  instead of a duplicate. */
export async function openPricingGapTask(key: string): Promise<TaskResult> {
  const session = await requireStaff();
  const parsed = parseGapKey(key);
  if (!parsed) return { ok: false, error: "מפתח פער לא תקין" };

  try {
    const usable = await eventIsUsable(parsed.rowId);
    if (!usable.ok) return usable;

    if (parsed.kind === "package" || parsed.kind === "ticket") {
      const scope: Scope = parsed.kind;
      const event = await loadEventForLight(parsed.rowId);
      if (!event) return { ok: false, error: "האירוע לא נמצא" };
      const detail = event.light_detail?.[scope];
      if (!detail) return { ok: false, error: "אין פרטי רמזור לסקופ הזה" };
      const { matches } = await listEventMatches(parsed.rowId);
      const opened = await insertPriceLightTask(event, scope, detail, matches, { id: session.sub });
      // `has_open_task` drops the row out of /price-light's "ממתינים להחלטה" (cached screen).
      if (opened.ok) invalidatePriceLight("rows");
      return opened;
    }

    if (parsed.kind === "price_review") {
      const openIds = await loadOpenTaskIds("price_review");
      const existingId = openIds.get(key);
      if (existingId) return { ok: true, taskId: existingId, existed: true };

      const ctx = await priceReviewContext(parsed.rowId);
      if (!ctx) return { ok: false, error: "לא נמצאה שורה תקועה לאירוע הזה" };
      const created = await createTask({
        title: ctx.title,
        description: ctx.description,
        priority: "high",
        source: "price_review",
        source_ref: {
          kind: "price_review",
          table: "events",
          row_id: parsed.rowId,
          label: ctx.label,
          url: `/events/${parsed.rowId}#fix-price`,
        },
      });
      if (!created.ok) return { ok: false, error: created.error };
      return { ok: true, taskId: created.id, existed: false };
    }

    return { ok: false, error: "סוג פער לא מוכר" };
  } catch (e) {
    console.error("openPricingGapTask failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "נכשל" };
  }
}

/**
 * "טופל": for a red light, records the same "הוזל" decision /price-light's own
 * button does AND mutes the row until the next nightly recompute (Dor, 16.09:
 * "'טופל' = רושם 'הוזל' ומסתיר עד החישוב הבא" - if the price genuinely has not
 * moved, the row is meant to come back). For a frozen price change, flips its
 * base_price_sync_log rows to `reviewed`.
 */
export async function markPricingGapHandled(key: string): Promise<Ok> {
  const session = await requireStaff();
  const parsed = parseGapKey(key);
  if (!parsed) return { ok: false, error: "מפתח פער לא תקין" };

  try {
    const usable = await eventIsUsable(parsed.rowId);
    if (!usable.ok) return usable;

    if (parsed.kind === "package" || parsed.kind === "ticket") {
      const scope: Scope = parsed.kind;
      const result = await recordRepriced(parsed.rowId, scope, session.sub);
      if (!result.ok) return result;
      const until = nextNightlyRun(new Date()).toISOString();
      const { error } = await db.from("events").update({ light_silenced_until: until }).eq("id", parsed.rowId);
      if (error) {
        console.error("markPricingGapHandled: mute failed", JSON.stringify(error));
        return { ok: false, error: "השתקת השורה נכשלה" };
      }
      invalidatePriceLight("rows");
      return { ok: true };
    }

    if (parsed.kind === "price_review") {
      await setSyncLogReviewed(parsed.rowId, HANDLED_BY_BUTTON_NOTE);
      return { ok: true };
    }

    return { ok: false, error: "סוג פער לא מוכר" };
  } catch (e) {
    console.error("markPricingGapHandled failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "נכשל" };
  }
}
