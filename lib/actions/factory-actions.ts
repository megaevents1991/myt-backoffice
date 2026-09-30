"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { buildDraftPayload } from "@/lib/services/draft-builder";
import { createEvent } from "@/lib/actions/event-actions";
import type { Event } from "@/types/app.types";
import type { DraftPayload, DraftStatus, EventDraft } from "@/types/factory.types";

// event_drafts predates the generated database types - cast once at the
// boundary, same pattern as the tasks/creative-gaps actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const DRAFT_COLUMNS =
  "id,source,scope,payload,status,missing,error,created_event_id,created_at";

/** Intake: one draft row per selected provider row (payload = mapper output). */
export async function createDraftBatch(input: {
  source: string;
  scope: Record<string, unknown>;
  payloads: DraftPayload[];
}): Promise<{ ok: boolean; ids: string[] }> {
  const session = await requireAdmin();
  if (input.payloads.length === 0) return { ok: false, ids: [] };

  const rows = input.payloads.map((payload) => ({
    source: input.source,
    scope: input.scope,
    payload,
    status: "building",
    created_by: session.sub,
  }));
  const { data, error } = await db
    .from("event_drafts")
    .insert(rows)
    .select("id");
  if (error) {
    console.error("factory: intake failed", JSON.stringify(error));
    return { ok: false, ids: [] };
  }
  await logAudit({
    action: "factory.intake",
    entityType: "event_draft",
    entityId: input.source,
    changes: { count: rows.length, scope: input.scope },
  });
  return { ok: true, ids: (data ?? []).map((row: { id: string }) => row.id) };
}

/**
 * Build ONE draft (oldest `building` row) - the factory screen loops this so
 * a big scope never hits a single-request timeout, and the admin can stop.
 */
export async function buildNextDraft(): Promise<{ done: boolean; built?: string }> {
  await requireAdmin();

  const { data: draft, error } = await db
    .from("event_drafts")
    .select("id,payload")
    .eq("status", "building")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("factory: pick next failed", JSON.stringify(error));
    return { done: true };
  }
  if (!draft) return { done: true };

  try {
    const built = await buildDraftPayload(draft.payload as DraftPayload);
    const { error: saveError } = await db
      .from("event_drafts")
      .update({
        payload: built.payload,
        missing: built.missing,
        status: built.missing.length > 0 ? "needs_input" : "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
    if (saveError) throw saveError;
  } catch (buildError) {
    console.error("factory: build failed", JSON.stringify(buildError));
    await db
      .from("event_drafts")
      .update({
        status: "error",
        error: buildError instanceof Error ? buildError.message : "build failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
  }
  return { done: false, built: draft.id };
}

export async function listDrafts(): Promise<EventDraft[]> {
  await requireAdmin();
  const { data, error } = await db
    .from("event_drafts")
    .select(DRAFT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("factory: list failed", JSON.stringify(error));
    return [];
  }
  return (data ?? []) as EventDraft[];
}

/** Inline grid edit - merges a patch into the stored payload. */
export async function updateDraftPayload(
  id: string,
  patch: Partial<Omit<Event, "id">>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();

  const { data: draft, error } = await db
    .from("event_drafts")
    .select("id,payload,missing,status")
    .eq("id", id)
    .single();
  if (error || !draft) {
    console.error("factory: draft load failed", JSON.stringify(error));
    return { ok: false, error: "Draft not found" };
  }
  // Already an event: editing the draft changes nothing on the site, and it
  // used to flip the row back to "ready" - a second approve made a duplicate.
  if (draft.status === "created") {
    return { ok: false, error: "Already created - edit the event itself" };
  }

  const payload = { ...(draft.payload as DraftPayload), ...patch };
  if (patch.location) {
    payload.location = {
      ...(draft.payload as DraftPayload).location,
      ...patch.location,
    };
  }

  // Recompute what is still humanly missing after the edit.
  const missing = (draft.missing as string[]).filter((field) => {
    if (field === "city_iata") return !payload.location.city_iata;
    if (field === "tickets") return payload.tickets_and_rates.length === 0;
    if (field === "base_flight_price") return payload.base_flight_price === 0;
    if (field === "base_hotel_price") return payload.base_hotel_price === 0;
    return true;
  });

  // Only a built draft moves between needs_input and ready. A `building` or
  // `error` draft keeps its status: an error draft's `missing` is empty (the
  // build never finished), so recomputing would have made it "ready" with an
  // unbuilt payload and let approve create it.
  const status: DraftStatus =
    draft.status === "needs_input" || draft.status === "ready"
      ? missing.length > 0
        ? "needs_input"
        : "ready"
      : draft.status;

  const { error: saveError } = await db
    .from("event_drafts")
    .update({
      payload,
      missing,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (saveError) {
    console.error("factory: draft update failed", JSON.stringify(saveError));
    return { ok: false, error: "Could not save the draft" };
  }
  return { ok: true };
}

/**
 * Approve: createEvent per draft; the created event id lands on the row.
 * Only a `ready` draft is created - a ticked needs_input / error / building /
 * created one would become a live catalog event with 0 prices or no tickets
 * (or a duplicate), so it is skipped and reported back with its status.
 */
export async function approveDrafts(ids: string[]): Promise<{
  created: number;
  failed: { id: string; error: string }[];
  skipped: { id: string; status: DraftStatus }[];
}> {
  await requireAdmin();
  const failed: { id: string; error: string }[] = [];
  const skipped: { id: string; status: DraftStatus }[] = [];
  let created = 0;

  for (const id of ids) {
    const { data: draft, error } = await db
      .from("event_drafts")
      .select("id,payload,status")
      .eq("id", id)
      .single();
    if (error || !draft) {
      failed.push({ id, error: "Draft not found" });
      continue;
    }
    if (draft.status !== "ready") {
      skipped.push({ id, status: draft.status });
      continue;
    }

    try {
      // The provider's id rides the draft for stadium memory only - `events`
      // has no column for it (the created tickets carry it as `eid`).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { source_event_id: _sourceId, ...payload } = draft.payload as DraftPayload;
      const event = await createEvent(payload);
      created += 1;
      await db
        .from("event_drafts")
        .update({
          status: "created",
          created_event_id: event.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "create failed";
      failed.push({ id, error: message });
      await db
        .from("event_drafts")
        .update({
          status: "error",
          error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
  }

  // Work-table retention (spec): terminal rows older than 30 days get purged.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  await db
    .from("event_drafts")
    .delete()
    .in("status", ["created", "error"])
    .lt("updated_at", cutoff.toISOString());

  await logAudit({
    action: "factory.approve",
    entityType: "event_draft",
    entityId: ids.join(","),
    changes: { created, failed: failed.length, skipped: skipped.length },
  });
  return { created, failed, skipped };
}

/** Physical delete - drafts are work items, not history. */
export async function discardDrafts(
  ids: string[],
): Promise<{ ok: boolean }> {
  await requireAdmin();
  const { error } = await db.from("event_drafts").delete().in("id", ids);
  if (error) {
    console.error("factory: discard failed", JSON.stringify(error));
    return { ok: false };
  }
  await logAudit({
    action: "factory.discard",
    entityType: "event_draft",
    entityId: ids.join(","),
    changes: { count: ids.length },
  });
  return { ok: true };
}
