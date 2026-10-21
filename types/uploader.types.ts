// Tour uploader (agent #3) - shared shapes. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md
// Tables: supabase/migrations/*_tour_uploader.sql (uploader_runs / uploader_items). Every jsonb column
// (plan, plan_ai, counts, show, location, decisions, warnings, blockers, question, payload) is typed
// below; the ones stored whole in a jsonb column are `type` aliases, not interfaces - an interface has
// no index signature, so it is NOT assignable to the DB `Json` type (checked with tsc).

export type SubjectKind = "artist" | "team" | "competition";

/** What staff confirmed to build: who, which shows, how to treat them, how to price them. */
export type UploaderPlan = {
  subject: { kind: SubjectKind; name_he: string | null; name_en: string };
  scope: {
    date_from: string | null;
    date_to: string | null;
    home_only: boolean;
    round: string | null;
    exclude_cities: string[];
    include_cities: string[];
  };
  rules: { with_location: "package"; without_location: "ticket_only" | "skip" };
  markups: { ticket_only: number | null; additional: number | null };
  suppliers: ["tixstock", "livetickets"];
  notes: string[];
};

export const RUN_STATUSES = ["planned", "building", "waiting", "review", "done", "stopped", "error"] as const;
export const ITEM_STATUSES = [
  "found",
  "building",
  "question",
  "skipped",
  "ready",
  "approved",
  "rejected",
  "error",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** The same show as each supplier lists it (null = that supplier does not have it). */
export type SupplierRef = {
  tixstock: { event_id: string; name: string; ticket_count: number | null; venue_map_url: string | null } | null;
  livetickets: { event_id: number; name_heb: string | null; sellable: number } | null;
};

/** One show, as found - before anything is built for it. */
export type ShowIdentity = {
  name_english: string;
  city: string;
  country_code: string | null;
  venue: string | null;
  date: string;
  lat: number | null;
  lon: number | null;
  suppliers: SupplierRef;
  competition: string | null;
  home_team: string | null;
  away_team: string | null;
  fallback: ("xs2event" | "p1")[];
};

export type QuestionKind = "pick_show" | "pick_date" | "pick_location" | "confirm_subject";

/** What the builder could not decide alone; a person answers it (as a task with source "uploader"). */
export type UploaderQuestion = {
  kind: QuestionKind;
  key: string;
  text: string;
  options: { key: string; label: string }[];
  free_text: boolean;
  asked_at: string;
  task_id: string | null;
  answer?: { key: string | null; text: string | null; by: string; at: string };
};

/** Something the builder chose by itself - shown on the review board so staff can overrule it. */
export type Decision = {
  code: string;
  text: string;
  /** `duplicate_dropped`: the event the show already is (the board links it). */
  event_id?: number;
};

/** A warning (look at it) or a blocker (approval is refused until fixed); `fix_url` deep-links the fix. */
export type Warning = {
  code: string;
  text: string;
  fix_url?: string;
};

export interface UploaderItem {
  id: string;
  run_id: string;
  position: number;
  show: ShowIdentity;
  status: ItemStatus;
  mode: "package" | "ticket_only" | null;
  location: {
    id: number;
    name: string;
    city_iata: string;
    latitude: number;
    longitude: number;
    km: number;
    /** Beyond NEAR_LOCATION_KM: no package flies here by itself (ticket-only / skipped items carry it as the two-city offer). */
    far: boolean;
  } | null;
  decisions: Decision[];
  warnings: Warning[];
  blockers: Warning[];
  question: UploaderQuestion | null;
  event_id: number | null;
  payload: Record<string, unknown> | null;
  skip_reason: string | null;
  error: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  rejected_final: boolean;
  created_at: string;
  updated_at: string;
}

export interface UploaderRun {
  id: string;
  created_by: string;
  asker_id: string;
  brief: string;
  plan: UploaderPlan;
  plan_ai: UploaderPlan | null;
  status: RunStatus;
  counts: Record<string, number>;
  ai_cost_usd: number;
  is_test: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
}
