/**
 * Tour uploader (agent #3) - the shapes the server actions (lib/actions/uploader-actions.ts) answer
 * with. Types only: a "use server" module may export nothing but async functions, so the screens
 * import these from here.
 */
import type { PlanPreview, SubjectArt } from "@/lib/uploader/run-rules";
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
      /** Which markups came from the last run (not from the brief). */
      fromPrior: ("ticket_only" | "additional")[];
      preview: PlanPreview;
      agent: "on" | "off" | "failed";
      problems: string[];
    }
  | { ok: false; kind: string };

export type PreviewResult = { ok: true; preview: PlanPreview } | { ok: false; kind: string; problems?: string[] };

export type CreateRunInput = {
  brief: string;
  plan: UploaderPlan;
  plan_ai: UploaderPlan | null;
  asker_id: string | null;
  is_test: boolean;
};

export type CreateRunResult = { ok: true; runId: string } | { ok: false; kind: string; problems?: string[] };

/** One step of the build loop. `done` = nothing left to claim (or the run is stopped / unknown); `kind` names a refusal. */
export type BuildStep = { done: boolean; itemId?: string; status?: ItemStatus; kind?: string };

export type RunView = {
  run: UploaderRun;
  items: UploaderItem[];
  /** item id -> the hidden event differs from what the builder stored (ready items with an event only). */
  edited: Record<string, boolean>;
  people: { id: string; name: string }[];
  subjectArt: SubjectArt;
};

export type ApproveResult =
  | { ok: true; edited: boolean }
  | { ok: false; kind: "not_ready" | "blocked" | "event_gone" | "db_error" | "bad_input" | "not_found" };

export type ApproveAllResult = { approved: number; failed: { itemId: string; kind: string }[]; kind?: string };

export type OpenQuestions = {
  count: number;
  newest: { run_id: string; subject: string; text: string } | null;
  /** The count could not be read (the badge shows nothing rather than a false zero). */
  failed?: boolean;
};

export type LocationOption = { id: number; name: string; city_iata: string | null };
