/**
 * Tour uploader (agent #3) - the shapes the server actions (lib/actions/uploader-actions.ts) answer
 * with. Types only: a "use server" module may export nothing but async functions, so the screens
 * import these from here.
 */
import type { ClassificationRow, ProposedRow } from "@/lib/uploader/classify";
import type { DescriptionValues, TemplateFamily } from "@/lib/uploader/description";
import type { DescriptionPlan, EditKind } from "@/lib/uploader/edit-changes";
import type { LocationInput } from "@/lib/uploader/location";
import type { PageTaskRef } from "@/lib/uploader/run-panel";
import type { PlanPreview, SubjectArt } from "@/lib/uploader/run-rules";
import type { LinkTeam, TeamRow } from "@/lib/uploader/team-names";
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
      /** What the model asked the person (`parseQuestions`) - shown on the plan card, answered through "כוון את ה-AI"; [] when the agent is off, failed or had none. */
      questions: string[];
      /** null = the preview's read failed (`previewKind` says why) - the parse itself is never thrown away. */
      preview: PlanPreview | null;
      previewKind?: string;
      agent: "on" | "off" | "failed";
      problems: string[];
    }
  | { ok: false; kind: string };

/**
 * `parseBrief`'s steer ("כוון את ה-AI", round 2): the person's instruction (3..500 characters), the plan as the card holds it
 * now, and the questions the model asked that the instruction answers. The server reads all three field by field (`parseSteer`).
 */
export type SteerInput = { instruction: string; plan: UploaderPlan; questions?: string[] };

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
  /**
   * The family's standing description template as the plan card has it (round 2, Task 11): saved with the run only when it
   * differs from the stored one; `null` / blank clears it; absent = the card did not touch it. The family is the plan's
   * subject kind's (`familyOf`), never the client's.
   */
  descriptionTemplate?: string | null;
};

/** `template`: "saved" = the card's template was written; "failed" = it could not be (a token the family lacks, a database error) - the run was made anyway. Absent = nothing to save. */
export type CreateRunResult = { ok: true; runId: string; template?: "saved" | "failed" } | { ok: false; kind: string; problems?: string[] };

/** `getFamilyTemplate`: the family's standing template (null = none saved, or the table is not migrated yet). */
export type FamilyTemplateResult = { ok: true; template: string | null } | { ok: false; kind: string };

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
  /** The id of the subject's page row (`football_teams` / `artists`) the run's cached subject found; null = none yet, or no readable cache. The panel's "פתח משימה" names its task by it. */
  subjectRowId: number | null;
  /**
   * item id -> the kinds of change a person made in the editor since the item's baseline (Alon round 3, note 2b):
   * `venue` (= `fixedByHand`) and / or `descriptions` (a ticket description cleared or set). The card's learn step 1
   * reads "✓" when any is there. Absent / empty = nothing to learn.
   */
  editKinds: Record<string, EditKind[]>;
  /** The `uploader_page` tasks already opened, not cancelled (Alon round 3, note 1): a panel row they cover leaves. [] when the read failed. */
  pageTasks: PageTaskRef[];
  /** The assignee of the newest `uploader_page` task - who "פתח משימה" starts on; null = none yet. */
  pageTaskAssignee: string | null;
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

/**
 * `classifyVenue` / `learnFromEvent`: how many events were rewritten and what the template ended up with.
 * `describeFailed` (`classifyVenue` only): everything was saved, but the venue's event descriptions could not all be
 * rewritten with the hall's Hebrew name - that never fails a classification; the dialog says so and a second confirm fills them.
 */
export type ClassifyResult =
  | { ok: true; events: number; reached: number; total: number; zones: number; dropped: number; unsure: number; describeFailed?: boolean }
  | { ok: false; kind: string; message?: string };

/** `proposeVenueClassification`: the dialog's rows (and what the AI proposed, for the confirm's diff). */
export type ProposeResult =
  | {
      ok: true;
      venue: { name: string; sourceUrl: string; templateId: string | null };
      rows: ClassificationRow[];
      /** What the AI proposed per category key; null = it gave nothing (off / failed / the per-person cap - `ai.reason` says why). */
      proposed: Record<string, ProposedRow> | null;
      /** The hall's Hebrew name the dialog's box opens with: the stored one (`venue_maps.name_he`), else the AI's proposal, else null (round 2, D3). */
      venue_he: string | null;
      /** `venue_he` is the AI's proposal (not a stored name) - the dialog says so beside the box. */
      venue_he_ai: boolean;
      /** The hall's drawing as text (round 2, Task 10) - the dialog's map; sanitized in the browser before it is drawn. */
      svg: string;
      /** The map sections the hall already excludes for every show (`venue_maps.dropped_categories.tixstock_sections`). */
      excludedSections: string[];
      shows: number;
      /** `reason`: null (used) | "not_needed" | "rate_limited" | "error" | the model call's own failure ("off" / "budget" / "timeout" / "bad_answer"). The dialog opens either way. */
      ai: { used: boolean; reason: string | null; problems: string[] };
    }
  | { ok: false; kind: "bad_input" | "not_found" | "db_error" | "svg_failed"; message?: string };

/** `learnPreview`: what the "learn from this event" confirm lists before it applies. */
/**
 * `learnPreview` (Alon round 3): the HALL kind - what the venue template learns and how many other shows of the hall
 * it rewrites, `{ ok: false }` when it cannot be learned (no template, the drawing unreadable), null = no hall change;
 * the DESCRIPTIONS kind - the plan and how many tickets on how many other shows it changes, null = none; `others` =
 * the run's other built shows.
 */
export type LearnPreview =
  | {
      ok: true;
      venue:
        | { ok: true; learned: { zones: number; newZones: number; dropped: string[]; descriptions: number; sections: number }; siblings: number }
        | { ok: false; kind: string; message?: string }
        | null;
      descriptions: { plan: DescriptionPlan; events: number; tickets: number } | null;
      others: number;
    }
  | { ok: false; kind: string };

/**
 * `learnFromEvent` (Alon round 3): `venue` = the hall part's answer (`classifyVenue`'s shape; null = not applied),
 * `descriptions` = what the descriptions pass wrote (`cut` = shows the time budget left - a second "החל" finishes them;
 * `failed` = writes that did not land), `note` = the note for the AI (null = none sent).
 */
export type LearnResult =
  | {
      ok: true;
      venue: ClassifyResult | null;
      descriptions: { events: number; tickets: number; cut: number; failed: number } | null;
      note: "saved" | "failed" | null;
    }
  | { ok: false; kind: string; message?: string };

/**
 * `proposeTeamNames`: the names dialog's rows; `renamable` = the built shows a confirm gives a Hebrew name with
 * no row to fill (the stored name has no Hebrew letter, `eventNames` now has one - ruling R24); `namesTask` = the
 * run's names task is still open. Either lets the dialog send a `[]` confirm.
 */
export type NamesProposeResult =
  | {
      ok: true;
      rows: TeamRow[];
      /** The supplier name of the row that is the run's SUBJECT (its page is the one missing), else null - that row cannot be linked ("זה עמוד קיים"). */
      subjectName: string | null;
      renamable: number;
      namesTask: boolean;
      ai: { used: boolean; reason: string | null; problems: string[] };
    }
  | { ok: false; kind: string; message?: string };

/** `createTeamsAndRename`: teams created, supplier names linked to a page that already existed (picked by a person or matched by the club rule), and events renamed. */
export type TeamsResult = { ok: true; created: number; linked: number; renamed: number } | { ok: false; kind: string; message?: string };

/** `searchTeamsForLink`: the pages a query finds (`findLinkTeams` - live first, at most 20). */
export type TeamSearchResult = { ok: true; teams: LinkTeam[] } | { ok: false; kind: string };

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

// ---- round 2: create a location from a question -------------------------------------------------------------

/**
 * `proposeLocation`: the form's starting values (the show's own coordinates, country and city spelling, plus
 * whatever the AI proposed) and what the AI did: `ok` = it proposed, `off` = the agent is switched off,
 * `rate_limited` = the per-person cap, `no_answer` = it failed, timed out or had nothing to ask. The dialog opens
 * either way.
 */
export type LocationProposeResult =
  | { ok: true; proposal: LocationInput; ai: "ok" | "off" | "no_answer" | "rate_limited" }
  | { ok: false; kind: string };

/**
 * `createLocationAndAnswer`: the location was created (`location_id`) and the question answered with it;
 * `applied` = how many OTHER open questions of the same city it answered too, `task_closed` = false when this
 * question's own task did not close (the answer is saved), `existing` = the city was already a location with an
 * IATA and was used as it is - nothing was created (final fix wave A2). A refusal carries a `problem` in the
 * dialog's words (`kind: "invalid"` - the form, or the city's no-IATA row; `kind: "far"` - the location is more than
 * FAR_VENUE_KM from the venue, sent again with `confirm_far: true` once a person confirms; or a created location
 * whose question could not be answered).
 */
export type LocationCreateResult =
  | { ok: true; location_id: number; applied: number; task_closed: boolean; existing: boolean }
  | { ok: false; kind: string; problem?: string };
