// Staff task for an event whose TixStock tickets cannot sell (04.10.2026): opened
// by the price sync when it takes the event off the site, or when some of its
// categories do not exist at the supplier; closed by it once the event sells
// again with nothing missing. One open task per event.
import { megaEventsTasks, type TaskResult } from "@/lib/tasks-scope";
import { logAudit } from "@/lib/audit";
import { deactivationText } from "@/lib/services/tixstock-availability";
import { OPEN_TASK_STATUSES, type TaskSourceRef } from "@/types/task.types";

const SOURCE = "supplier_gap";

export interface SupplierGap {
  eventId: number;
  eventName: string;
  eventDate: string;
  /** `events.deactivated_reason` after the sync - null = the event is still on the site. */
  reason: string | null;
  /** Our categories TixStock does not have for the show. */
  missing: string[];
  /** Our categories with nothing on sale there. */
  soldOut: string[];
  /** Every category TixStock has for the show, when its feed said. */
  supplierCategories: string[] | null;
}

function sourceRef(gap: SupplierGap): TaskSourceRef {
  return { kind: SOURCE, table: "events", row_id: gap.eventId, label: gap.eventName, url: `/events/${gap.eventId}` };
}

function title(gap: SupplierGap): string {
  const what = gap.reason
    ? "ירד מהאתר · אין כרטיסים למכירה"
    : "קטגוריה שלא קיימת אצל TixStock";
  return `${what} · ${gap.eventName} ${gap.eventDate.slice(0, 10)}`;
}

function description(gap: SupplierGap): string {
  const head = gap.reason
    ? `האירוע הורד מהאתר אוטומטית: ${deactivationText(gap.reason)}.`
    : "האירוע עדיין באתר, אבל חלק מהקטגוריות שלנו לא קיימות ב-TixStock להופעה הזו והורדו מהמכירה.";
  const fix = gap.missing.length
    ? "מה לעשות: לפתוח את האירוע, לוודא שה-eid והמפה שייכים להופעה הזו (אירוע משוכפל שומר את הקטגוריות והמפה של המקור), ולהוסיף את הקטגוריות מהרשימה של TixStock."
    : "מה לעשות: אם יש ב-TixStock קטגוריות אחרות למכירה - להוסיף אותן; אפשר גם לצרף ספק נוסף (LiveTickets) או למחוק את האירוע.";
  return [
    head,
    gap.missing.length ? `אצלנו, לא קיים אצל הספק: ${gap.missing.join(", ")}` : "",
    gap.soldOut.length ? `אצלנו, אזל אצל הספק: ${gap.soldOut.join(", ")}` : "",
    gap.supplierCategories?.length ? `הקטגוריות של TixStock להופעה: ${gap.supplierCategories.join(", ")}` : "",
    fix,
    "אחרי התיקון: \"בדוק עכשיו\" בעורך האירוע מחזיר אותו לאתר מיד וסוגר את המשימה. בלי זה - בסנכרון המחירים הבא (4 פעמים ביום), ברגע שיש כרטיס למכירה.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ids of the events that have an open supplier_gap task - one read per sync run. */
export async function eventsWithOpenSupplierGapTask(): Promise<Map<number, string>> {
  const { data, error } = (await megaEventsTasks()
    .select("id,source_ref")
    .eq("source", SOURCE)
    .is("deleted_at", null)
    .in("status", OPEN_TASK_STATUSES)) as TaskResult<{ id: string; source_ref: TaskSourceRef | null }[]>;
  if (error) {
    console.error(JSON.stringify(error));
    throw error;
  }
  const byEvent = new Map<number, string>();
  for (const row of data ?? []) {
    const eventId = Number(row.source_ref?.row_id);
    if (Number.isFinite(eventId)) byEvent.set(eventId, row.id);
  }
  return byEvent;
}

/** Opens the task. The caller has already checked there is no open one for the event. */
export async function openSupplierGapTask(gap: SupplierGap): Promise<string | null> {
  const { data, error } = (await megaEventsTasks()
    .insert({
      title: title(gap),
      description: description(gap),
      // An event off the site is lost sales today; a stray category is housekeeping.
      priority: gap.reason ? "high" : "medium",
      assignee_id: null,
      created_by: null,
      source: SOURCE,
      source_ref: sourceRef(gap),
      board: "ops",
    })
    .select("id")
    .single()) as TaskResult<{ id: string }>;
  if (error || !data) {
    console.error(JSON.stringify(error));
    return null;
  }
  await logAudit({
    action: "supplier_gap.task_opened",
    entityType: "event",
    entityId: gap.eventId,
    metadata: { task_id: data.id, reason: gap.reason, missing: gap.missing, sold_out: gap.soldOut, auto: true },
  });
  return data.id;
}

/** The event sells again with nothing missing - the task has nothing left to ask for. */
export async function closeSupplierGapTask(eventId: number, taskId: string): Promise<boolean> {
  const note = `האירוע חזר למכירה אוטומטית (${new Date().toISOString().slice(0, 10)})`;
  const { data: task } = (await megaEventsTasks()
    .select("description")
    .eq("id", taskId)
    .maybeSingle()) as TaskResult<{ description: string | null }>;
  const { error } = (await megaEventsTasks()
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      description: `${task?.description ?? ""}\n${note}`.trim(),
    })
    .eq("id", taskId)) as TaskResult<null>;
  if (error) {
    console.error(JSON.stringify(error));
    return false;
  }
  await logAudit({
    action: "supplier_gap.task_autoclosed",
    entityType: "event",
    entityId: eventId,
    metadata: { task_id: taskId },
  });
  return true;
}
