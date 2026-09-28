// Events-factory types (spec 2026-09-02, section 8).
import type { Event } from "@/types/app.types";

export const DRAFT_STATUSES = [
  "building",
  "ready",
  "needs_input",
  "approved",
  "created",
  "error",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Fields the builder tracks as "automation could not fill this". */
export const DRAFT_MISSING_FIELDS = [
  "city_iata",
  "tickets",
  "base_flight_price",
  "base_hotel_price",
] as const;
export type DraftMissingField = (typeof DRAFT_MISSING_FIELDS)[number];

/**
 * A draft's payload: the new event, plus the provider's own event id where the
 * event has no column for it. A TixStock event's id lives only on its tickets
 * (`eid`), so the draft keeps it here for stadium memory to stamp on the copies;
 * `approveDrafts` strips it before the insert.
 */
export type DraftPayload = Omit<Event, "id"> & { source_event_id?: string };

export interface EventDraft {
  id: string;
  source: string;
  scope: Record<string, unknown>;
  payload: DraftPayload;
  status: DraftStatus;
  missing: DraftMissingField[];
  error: string | null;
  created_event_id: number | null;
  created_at: string;
}
