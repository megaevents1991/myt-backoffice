// Price-light (רמזור) task lifecycle: open a task when a scope goes red,
// dedupe against an already-open task for the same event+scope, and close it
// again automatically once the scope leaves red. Spec:
// docs/superpowers/specs/2026-09-09-price-light-design.md.
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { signedUsd } from "@/lib/services/price-light";
import type { LightEvent, Lights } from "@/lib/services/price-light-store";
import type { LightScopeDetail, MatchRow, Scope } from "@/types/price-light.types";
import type { TaskSourceRef } from "@/types/task.types";

// New table predates the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SCOPE_HE: Record<Scope, string> = { package: "חבילה", ticket: "כרטיס" };

function sourceRef(event: LightEvent, scope: Scope): TaskSourceRef {
  return { kind: scope, table: "events", row_id: event.id, label: event.name, url: `/events/${event.id}#fix-price` };
}

function description(scope: Scope, d: LightScopeDetail, history: MatchRow[]): string {
  const lines = [
    `שלנו: $${d.our_usd ?? "?"}`,
    `${d.competitor ?? "מתחרה"}: ${d.raw ?? "?"} ${d.raw_currency ?? ""} → מנורמל $${d.normalized_usd ?? "?"}`,
    d.adjustments.length ? `נרמול: ${d.adjustments.map((a) => a.label).join(", ")}` : "נרמול: אין",
    `הפרש: ${d.diff_usd != null ? signedUsd(d.diff_usd) : "?"}`,
    ...Object.entries(d.per_competitor).map(
      ([k, v]) => `${k}: ${v.status}${v.normalized_usd != null ? ` $${v.normalized_usd}` : ""}`,
    ),
    "היסטוריה:",
    ...history
      .filter((m) => m.scope === scope)
      .slice(0, 3)
      .map(
        (m) =>
          `  ${m.created_at.slice(0, 10)} ${m.competitor} ${m.status} ${m.normalized_usd != null ? `$${m.normalized_usd}` : ""} ${m.diff_usd != null ? signedUsd(m.diff_usd) : ""}`,
      ),
  ];
  return lines.join("\n");
}

/** Newest open price_light task for this event+scope, or null. */
async function openTaskFor(eventId: number, scope: Scope): Promise<{ id: string; description: string | null } | null> {
  const { data, error } = await db
    .from("tasks")
    .select("id,description")
    .eq("source", "price_light")
    .is("deleted_at", null)
    .in("status", ["todo", "in_progress"])
    .contains("source_ref", { row_id: eventId, kind: scope })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify(error));
    throw error;
  }
  return data ? { id: data.id, description: data.description ?? null } : null;
}

export async function openPriceLightTask(
  event: LightEvent,
  scope: Scope,
  detail: LightScopeDetail,
  history: MatchRow[],
  actor: { id: string | null },
): Promise<{ ok: true; taskId: string; existed: boolean } | { ok: false; error: string }> {
  try {
    const existing = await openTaskFor(event.id, scope);
    if (existing) return { ok: true, taskId: existing.id, existed: true };
    const { data, error } = await db
      .from("tasks")
      .insert({
        title: `אדום · ${SCOPE_HE[scope]} · ${event.name} ${event.date.slice(0, 10)}`,
        description: description(scope, detail, history),
        priority: "high",
        assignee_id: null,
        created_by: actor.id,
        source: "price_light",
        source_ref: sourceRef(event, scope),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error(JSON.stringify(error));
      return { ok: false, error: "task insert failed" };
    }
    await logAudit({ action: "price_light.task_opened", entityType: "event", entityId: event.id, metadata: { scope, task_id: data.id } });
    return { ok: true, taskId: data.id, existed: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/** Called by recomputeEventLights after a write. Closes open price_light tasks whose scope is no longer red. */
export async function closePriceLightTasksIfNotRed(eventId: number, lights: Lights): Promise<number> {
  let closed = 0;
  for (const scope of ["package", "ticket"] as const) {
    if (lights[scope] === "red") continue;
    const task = await openTaskFor(eventId, scope).catch(() => null);
    if (!task) continue;
    const note = `האור ירד מאדום אוטומטית (${new Date().toISOString().slice(0, 10)})`;
    const { error } = await db
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), description: `${task.description ?? ""}\n${note}`.trim() })
      .eq("id", task.id);
    if (error) {
      console.error(JSON.stringify(error));
      continue;
    }
    closed += 1;
    await logAudit({ action: "price_light.task_autoclosed", entityType: "event", entityId: eventId, metadata: { scope, task_id: task.id } });
  }
  return closed;
}
