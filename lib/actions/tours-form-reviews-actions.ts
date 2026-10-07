"use server";

/**
 * Reviews picked from the feedback forms, for the Reviews section of a tours
 * company's site (Website > Homepage > Reviews > "Pick from the feedback forms").
 *
 * The forms and their answers are Mega Events data (public.forms / form_responses
 * have no company of their own yet), so this action is open only to someone who may
 * already read every form in /forms: a member of the tours company who ALSO works in
 * Mega Events. It only reads; a picked answer is copied into the section by the
 * editor and saved with the page (lib/actions/tours-site-actions.ts), which is where
 * the audit row is written.
 */
import { requireCompany } from "@/lib/company";
import { worksInMegaEvents } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { actionFail, chunk, plainFail, type ActionResult } from "@/lib/tours/action-kit";
import {
  canFeedReviews,
  formReviewCandidate,
  formReviewShape,
  type FormReviewCandidate,
  type FormReviewField,
} from "@/lib/tours/form-reviews";

const SCOPE = "tours-form-reviews-actions";

// forms / form_fields / form_responses / form_invites postdate types/database.types.ts - boundary cast,
// as in the forms actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** How many answers one read looks at, newest first. */
const ANSWERS_MAX = 2000;
const PAGE = 1000;
const ID_BATCH = 200;

export interface FeedbackFormOption {
  id: number;
  title: string;
  live: boolean;
}

export interface FormReviewCandidates {
  /** The forms that ask for a free text, the live ones first. */
  forms: FeedbackFormOption[];
  /** The form the answers below belong to; null when no form can feed reviews. */
  formId: number | null;
  /** Answers with a text, newest first. */
  candidates: FormReviewCandidate[];
  /** How many answers the form has in all (with or without a text). */
  answers: number;
}

const FORMS_ARE_MEGA_EVENTS =
  "The feedback forms belong to the Mega Events backoffice, so only someone who also works there can pick reviews from them. Ask a Mega Events staff member, or type the reviews here.";

type Row = Record<string, unknown>;

const toField = (row: Row): FormReviewField => {
  const config = row.config && typeof row.config === "object" && !Array.isArray(row.config) ? (row.config as Row) : {};
  const max = Number(config.max);
  return {
    id: Number(row.id),
    type: String(row.type ?? ""),
    position: Number(row.position) || 0,
    staffOnly: row.staff_only === true,
    reviewScore: config.review_score === true,
    max: Number.isFinite(max) && max > 0 ? max : 5,
  };
};

/** What a trip link says about its trip: its code ("BBC-124"), else its name. */
const tripLabelOf = (invite: Row): string => {
  const prefix = typeof invite.trip_code_prefix === "string" ? invite.trip_code_prefix.trim() : "";
  const num = invite.trip_code_num == null ? "" : String(invite.trip_code_num).trim();
  if (prefix && num) return `${prefix}-${num}`;
  return typeof invite.label === "string" ? invite.label.trim() : "";
};

/**
 * The answers of one feedback form that can be shown as reviews. `formId` null (or a
 * form that cannot feed reviews) = the first live form that can.
 */
export async function getFormReviewCandidates(formId: number | null): Promise<ActionResult<FormReviewCandidates>> {
  try {
    const { session } = await requireCompany("tours");
    if (!(await worksInMegaEvents(session))) return plainFail(FORMS_ARE_MEGA_EVENTS);

    const { data: formRows, error: formsError } = await db.from("forms").select("id, title_he, title_en, status").is("is_deleted", null).order("id");
    if (formsError) throw new Error(`forms read: ${formsError.message}`);
    const allForms = (formRows ?? []) as Row[];
    if (allForms.length === 0) return { success: true, data: { forms: [], formId: null, candidates: [], answers: 0 } };

    const { data: fieldRows, error: fieldsError } = await db
      .from("form_fields")
      .select("id, form_id, type, position, staff_only, config")
      .in(
        "form_id",
        allForms.map((f) => Number(f.id)),
      )
      .in("type", ["short_text", "long_text", "rating", "date"])
      .limit(5000);
    if (fieldsError) throw new Error(`form_fields read: ${fieldsError.message}`);
    const fieldsOfForm = new Map<number, FormReviewField[]>();
    for (const row of (fieldRows ?? []) as Row[]) {
      const id = Number(row.form_id);
      fieldsOfForm.set(id, [...(fieldsOfForm.get(id) ?? []), toField(row)]);
    }

    const forms: FeedbackFormOption[] = allForms
      .filter((f) => canFeedReviews(formReviewShape(fieldsOfForm.get(Number(f.id)) ?? [])))
      .map((f) => ({
        id: Number(f.id),
        title: (typeof f.title_he === "string" && f.title_he.trim()) || (typeof f.title_en === "string" && f.title_en.trim()) || `Form ${f.id}`,
        live: f.status === "live",
      }))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.id - b.id);
    const chosen = forms.find((f) => f.id === formId) ?? forms[0] ?? null;
    if (!chosen) return { success: true, data: { forms, formId: null, candidates: [], answers: 0 } };
    const shape = formReviewShape(fieldsOfForm.get(chosen.id) ?? []);

    // newest first, read in pages: a plain select stops at 1,000 rows without saying so
    const responses: Row[] = [];
    for (let from = 0; from < ANSWERS_MAX; from += PAGE) {
      const { data, error } = await db
        .from("form_responses")
        .select("id, answers, submitted_at, invite_id")
        .eq("form_id", chosen.id)
        .is("is_deleted", null)
        .order("submitted_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`form_responses read: ${error.message}`);
      responses.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }

    // the trip of each answer, from its trip link
    const inviteIds = [...new Set(responses.map((r) => r.invite_id).filter((id): id is number | string => id != null))];
    const tripOfInvite = new Map<string, string>();
    for (const ids of chunk(inviteIds, ID_BATCH)) {
      const { data, error } = await db.from("form_invites").select("id, label, trip_code_prefix, trip_code_num").in("id", ids);
      if (error) throw new Error(`form_invites read: ${error.message}`);
      for (const invite of (data ?? []) as Row[]) tripOfInvite.set(String(invite.id), tripLabelOf(invite));
    }

    const candidates = responses.flatMap((r) => {
      const one = formReviewCandidate(
        shape,
        { id: Number(r.id), answers: r.answers, submittedAt: String(r.submitted_at ?? "") },
        r.invite_id == null ? "" : (tripOfInvite.get(String(r.invite_id)) ?? ""),
      );
      return one ? [one] : [];
    });
    return { success: true, data: { forms, formId: chosen.id, candidates, answers: responses.length } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the answers of the feedback forms");
  }
}
