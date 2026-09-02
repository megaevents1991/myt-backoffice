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

export interface EventDraft {
  id: string;
  source: string;
  scope: Record<string, unknown>;
  payload: Omit<Event, "id">;
  status: DraftStatus;
  missing: DraftMissingField[];
  error: string | null;
  created_event_id: number | null;
  created_at: string;
}
