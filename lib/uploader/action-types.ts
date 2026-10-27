/**
 * Tour uploader (agent #3) - the shapes the server actions (lib/actions/uploader-actions.ts) answer
 * with. Types only: a "use server" module may export nothing but async functions, so the screens
 * import these from here.
 */
import type { ClassificationRow, ProposedRow } from "@/lib/uploader/classify";
import type { DescriptionValues, TemplateFamily } from "@/lib/uploader/description";
import type { PlanPreview, SubjectArt } from "@/lib/uploader/run-rules";
import type { TeamRow } from "@/lib/uploader/team-names";
import type { ItemStatus, UploaderItem, UploaderPlan, UploaderRun } from "@/types/uploader.types";

/** The ai-factory-actions shape: success, or a machine-readable `kind` the screen words. */
export type Ok = { ok: true } | { ok: false; kind: string };

export type { PlanPreview, SubjectArt };

export type ParseBriefResult =
  | {
      ok: true;
      /** The plan to confirm: the model's plan (or the empty plan) with the last run's markups filled in. */
      plan: UploaderPlan;
      /** The model's own plan before those defaults - what `createRun` takes as `plan_ai`; null when the agent did not answer with one. */
      planAi: UploaderPlan | null;
      /** The signature of `planAi` with this brief (`planTokenFor`) - hand it back to `createRun` with `plan_ai`; absent = no model plan, or no signing key. */
      planToken?: string;
      /** Which markups came from the last run (not from the brief). */
      fromPrior: ("ticket_only" | "additional")[];
      /** null = the preview's read failed (`previewKind` says why) - the parse itself is never thrown away. */
      preview: PlanPreview | null;
      previewKind?: string;
      agent: "on" | "off" | "failed";
      problems: string[];
    }
  | { ok: false; kind: string };

export type PreviewResult = { ok: true; preview: PlanPreview } | { ok: false; kind: string; problems?: string[] };

export type CreateRunInput = {
  brief: string;
  plan: UploaderPlan;
  plan_ai: UploaderPlan | null;
  /** `parseBrief`'s `planToken`: `plan_ai` is used (the edit lessons) only when it signs exactly that plan and this brief. */
  planToken?: string;
  /** Ignored: the asker is always the session's user. Kept so existing callers stay valid. */
  asker_id: string | null;
  is_test: boolean;
};

export type CreateRunResult = { ok: true; runId: string } | { ok: false; kind: string; problems?: string[] };

/** One step of the build loop. `done` = nothing left to claim (or the run is stopped / unknown); `kind` names a refusal. */
export type BuildStep = { done: boolean; itemId?: string; status?: ItemStatus; kind?: string };

/** The board's read of one run. */
export type RunBoard = {
  run: UploaderRun;
  /** Soonest first (position, then creation). A `ready` item's `blockers` are re-judged against its live event row (`liveBlockers`) when that row was read. */
  items: UploaderItem[];
  /** item id -> the hidden event differs from what the builder stored (ready items with an event only). */
  edited: Record<string, boolean>;
  /** The events read behind `edited` failed: `edited` is empty because it is UNKNOWN, not because nothing was edited. */
  editedUnknown: boolean;
  people: { id: string; name: string }[];
  /** `getRun(id, { people: false })`: `people` was not read (it is []) - keep the list the board already has. */
  peopleOmitted?: true;
  subjectArt: SubjectArt;
  /** item id -> a person arranged this item's TixStock tickets in the editor (zones / descriptions / categories differ from the build): the panel offers "learn from this event". */
  fixedByHand: Record<string, boolean>;
  /** The club (or artist) names the run still has no Hebrew name for (`missingSides`) - the panel's names row lists them. */
  missingNames: string[];
};

/** `getRun`'s answer when the run exists: the board, or `{ run: null, kind: "db_error" }` when a read failed (`getRun` answers null only for "no such run"). */
export type RunView = RunBoard | { run: null; kind: "db_error" };

export type ApproveResult =
  /** `note: "moved"` = the event was listed, but the item moved meanwhile (approved by another click) - the approval on file is that one. */
  | { ok: true; edited: boolean; note?: "moved" }
  | { ok: false; kind: "not_ready" | "blocked" | "event_gone" | "db_error" | "bad_input" | "not_found" };

/** `kind` = the whole call failed - except `recheck_skipped`: every approval stands, only the availability re-check found no time left. */
export type ApproveAllResult = { approved: number; failed: { itemId: string; kind: string }[]; kind?: string };

export type OpenQuestions = {
  count: number;
  newest: { run_id: string; subject: string; text: string } | null;
  /** The count could not be read (the badge shows nothing rather than a false zero). */
  failed?: boolean;
};

export type LocationOption = { id: number; name: string; city_iata: string | null };

// ---- round "אלון 1": classification, names, learn ------------------------------------------------------

/** `classifyVenue` / `learnFromEvent`: how many events were rewritten and what the template ended up with. */
export type ClassifyResult =
  | { ok: true; events: number; reached: number; total: number; zones: number; dropped: number; unsure: number }
  | { ok: false; kind: string; message?: string };

/** `proposeVenueClassification`: the dialog's rows (and what the AI proposed, for the confirm's diff). */
export type ProposeResult =
  | {
      ok: true;
      venue: { name: string; sourceUrl: string; templateId: string | null };
      rows: ClassificationRow[];
      /** What the AI proposed per category key; null = it gave nothing (off / failed / the per-person cap - `ai.reason` says why). */
      proposed: Record<string, ProposedRow> | null;
      shows: number;
      /** `reason`: null (used) | "not_needed" | "rate_limited" | "error" | the model call's own failure ("off" / "budget" / "timeout" / "bad_answer"). The dialog opens either way. */
      ai: { used: boolean; reason: string | null; problems: string[] };
    }
  | { ok: false; kind: "bad_input" | "not_found" | "db_error" | "svg_failed"; message?: string };

/** `learnPreview`: what the "learn from this event" confirm lists before it applies. */
export type LearnPreview =
  | { ok: true; learned: { zones: number; newZones: number; dropped: string[]; descriptions: number }; siblings: number }
  | { ok: false; kind: string };

/**
 * `proposeTeamNames`: the names dialog's rows; `renamable` = the built shows a confirm gives a Hebrew name with
 * no row to fill (the stored name has no Hebrew letter, `eventNames` now has one - ruling R24); `namesTask` = the
 * run's names task is still open. Either lets the dialog send a `[]` confirm.
 */
export type NamesProposeResult =
  | { ok: true; rows: TeamRow[]; renamable: number; namesTask: boolean; ai: { used: boolean; reason: string | null; problems: string[] } }
  | { ok: false; kind: string; message?: string };

/** `createTeamsAndRename`: teams created and events renamed. */
export type TeamsResult = { ok: true; created: number; renamed: number } | { ok: false; kind: string; message?: string };

/** `getDescriptionTemplate`: the family's standing template (Alon 25.10), the tokens it may use, and one built show's values for the live preview. */
export type DescriptionTemplateView =
  | {
      ok: true;
      family: TemplateFamily;
      template: string | null;
      /** false = the settings table is not migrated yet - nothing can be saved. */
      ready: boolean;
      tokens: { token: string; hint: string }[];
      /** The first built show's token values (null = the run has none yet) and its event's name. */
      sample: DescriptionValues | null;
      sampleName: string | null;
      /** The run's built events (ready / approved) "apply" would visit. */
      targets: number;
    }
  | { ok: false; kind: string };

/** `saveDescriptionTemplate`: saved; `applied` = what the run's rewrite did (null when not asked to apply). */
export type DescriptionSaveResult =
  | { ok: true; applied: { events: number; editedByHand: number; english: number } | null }
  | { ok: false; kind: string; problem?: string };
