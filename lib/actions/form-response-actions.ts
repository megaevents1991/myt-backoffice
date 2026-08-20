"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase-server";
import {
  requireFormVisible,
  requireFormsAccess,
  requireStaff,
} from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { validateAnswers } from "@/lib/forms/validation";
import { strings } from "@/lib/forms/i18n";
import { resolveLang } from "@/types/form.types";
import type {
  AnswerMap,
  AnswerValue,
  FormField,
  FormLang,
  FormResponseRow,
  PublicForm,
} from "@/types/form.types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const formsTable = () => (supabase as any).from("forms");
const fieldsTable = () => (supabase as any).from("form_fields");
const invitesTable = () => (supabase as any).from("form_invites");
const responsesTable = () => (supabase as any).from("form_responses");
/* eslint-enable @typescript-eslint/no-explicit-any */

const PUBLIC_FORM_COLUMNS =
  "id,slug,title_en,title_he,description_en,description_he,languages,default_lang," +
  "thank_you_en,thank_you_he,status,allow_multiple,theme,accent_color,logo_url,cover_image_url";

const FIELD_COLUMNS =
  "id,form_id,type,position,label_en,label_he,help_en,help_he," +
  "placeholder_en,placeholder_he,required,staff_only,options,config";

/**
 * Submissions allowed from one IP to one form per hour. Sized for a whole trip
 * group answering a trip link from the same hotel/bus wifi (one NAT'd IP) -
 * the honeypot and per-field validation still stand between us and bots.
 */
const RATE_LIMIT_PER_HOUR = 40;
/** Guards against a client posting thousands of keys. */
const MAX_SUBMITTED_KEYS = 300;

/** A staff-only answer shown to the client read-only (the trip ticket). */
export type StaffSummaryItem = { field: FormField; value: AnswerValue };

export type PublicFormLoad =
  | { state: "not_found" }
  | { state: "closed" }
  | { state: "already_submitted"; lang: FormLang }
  | {
      state: "ok";
      payload: PublicForm;
      inviteToken: string | null;
      prefill: AnswerMap;
      /**
       * Escort answers from a trip link's prefill, for DISPLAY only - the
       * fields stay out of `payload.fields`, so the client can read which trip
       * this is but can neither edit nor submit them.
       */
      staffSummary: StaffSummaryItem[];
      /** Trip-link identity ("BBC" + "124") for the ticket header, if any. */
      tripCode: { prefix: string; num: string } | null;
      recipientName: string | null;
      lang: FormLang;
    };

export type SubmitResult =
  | {
      ok: true;
      thankYou: string;
      /**
       * External review URL, present only when every answered star rating
       * scored full marks and the form has one configured. Deliberately not
       * part of the public form payload - the client sees it only after
       * earning it.
       */
      reviewLink?: string | null;
    }
  | { ok: false; message: string; errors?: Record<string, string> };

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return h.get("x-real-ip");
}

async function loadFields(formId: number): Promise<FormField[]> {
  const { data, error } = await fieldsTable()
    .select(FIELD_COLUMNS)
    .eq("form_id", formId)
    .order("position", { ascending: true });

  if (error) {
    console.error("loadFields failed:", JSON.stringify(error));
    throw error;
  }
  return (data ?? []) as FormField[];
}

/**
 * What the CLIENT may see: staff-only fields (and their prefilled values) are
 * the escort's, attached server-side on submit - they never leave the server.
 */
function clientFields(fields: FormField[]): FormField[] {
  return fields.filter((field) => !field.staff_only);
}

function clientPrefill(fields: FormField[], prefill: AnswerMap): AnswerMap {
  const staffIds = new Set(
    fields.filter((f) => f.staff_only).map((f) => String(f.id)),
  );
  return Object.fromEntries(
    Object.entries(prefill).filter(([key]) => !staffIds.has(key)),
  );
}

/** Staff answers a trip link carries, in field order, for the trip ticket. */
function staffSummary(fields: FormField[], prefill: AnswerMap): StaffSummaryItem[] {
  return fields
    .filter((field) => field.staff_only && field.type !== "section")
    .map((field) => ({ field, value: prefill[String(field.id)] }))
    .filter(
      (item): item is StaffSummaryItem =>
        item.value !== undefined && item.value !== null && item.value !== "",
    );
}

/**
 * Public read of a form by its shared slug. Only `live`, non-deleted forms are
 * ever returned - the publish state is re-checked on submit too.
 */
export async function getPublicFormBySlug(
  slug: string,
): Promise<PublicFormLoad> {
  const { data, error } = await formsTable()
    .select(PUBLIC_FORM_COLUMNS)
    .eq("slug", slug)
    .is("is_deleted", null)
    .maybeSingle();

  if (error) {
    console.error("getPublicFormBySlug failed:", JSON.stringify(error));
    return { state: "not_found" };
  }
  if (!data) return { state: "not_found" };
  if (data.status === "draft") return { state: "not_found" };
  if (data.status !== "live") return { state: "closed" };

  return {
    state: "ok",
    payload: { form: data, fields: clientFields(await loadFields(data.id)) },
    inviteToken: null,
    prefill: {},
    staffSummary: [],
    tripCode: null,
    recipientName: null,
    lang: resolveLang(
      data.languages,
      null,
      (data.default_lang as FormLang) ?? "en",
    ),
  };
}

/**
 * Public read of a form by invite token. Stamps `opened_at` the first time the
 * recipient opens the link.
 */
export async function getPublicFormByToken(
  token: string,
): Promise<PublicFormLoad> {
  const { data: invite, error } = await invitesTable()
    .select(
      "id,form_id,token,lang,prefill,recipient_name,submitted_at,opened_at," +
        "multi_use,trip_code_prefix,trip_code_num",
    )
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("getPublicFormByToken failed:", JSON.stringify(error));
    return { state: "not_found" };
  }
  if (!invite) return { state: "not_found" };

  const { data: form, error: formError } = await formsTable()
    .select(PUBLIC_FORM_COLUMNS)
    .eq("id", invite.form_id)
    .is("is_deleted", null)
    .maybeSingle();

  if (formError || !form) return { state: "not_found" };

  // A single-language form ignores the invite's language - there is nothing else
  // to render it in.
  const lang = resolveLang(
    form.languages,
    invite.lang as FormLang | null,
    (form.default_lang as FormLang) ?? "en",
  );

  // A trip link is shared by a whole group - it never locks after a submission.
  if (invite.submitted_at && !form.allow_multiple && !invite.multi_use) {
    return { state: "already_submitted", lang };
  }
  if (form.status === "draft") return { state: "not_found" };
  if (form.status !== "live") return { state: "closed" };

  if (!invite.opened_at) {
    await invitesTable()
      .update({ opened_at: new Date().toISOString() })
      .eq("id", invite.id);
  }

  const fields = await loadFields(form.id);
  const invitePrefill = (invite.prefill ?? {}) as AnswerMap;
  return {
    state: "ok",
    payload: { form, fields: clientFields(fields) },
    inviteToken: token,
    prefill: clientPrefill(fields, invitePrefill),
    staffSummary: staffSummary(fields, invitePrefill),
    tripCode:
      invite.trip_code_prefix && invite.trip_code_num
        ? { prefix: invite.trip_code_prefix, num: invite.trip_code_num }
        : null,
    recipientName: invite.recipient_name ?? null,
    lang,
  };
}

export type SubmitInput = {
  /** Exactly one of these identifies the form. Never trusted beyond the lookup. */
  slug?: string;
  token?: string;
  answers: Record<string, unknown>;
  lang: FormLang;
  /** Honeypot - must stay empty. */
  hp?: string;
};

/**
 * PUBLIC endpoint - reachable by anyone with a form link. Everything the client
 * sends is untrusted:
 *
 *  - `form_id` / `invite_id` are resolved here from the slug or token; the
 *    client cannot name them.
 *  - The publish state is re-checked, so a page rendered before the form was
 *    closed cannot still write.
 *  - Answers are validated against the stored field definitions and any key
 *    that is not a field of this form is dropped.
 *  - Submissions per IP per form are capped per hour.
 */
export async function submitFormResponse(
  input: SubmitInput,
): Promise<SubmitResult> {
  const lang: FormLang = input.lang === "he" ? "he" : "en";
  const t = strings(lang);

  try {
    // Honeypot: bots fill hidden inputs. Look successful, store nothing.
    if (input.hp && input.hp.trim() !== "") {
      return { ok: true, thankYou: t.thankYou };
    }

    const raw = input.answers ?? {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, message: t.sendFailed };
    }
    if (Object.keys(raw).length > MAX_SUBMITTED_KEYS) {
      return { ok: false, message: t.sendFailed };
    }

    // --- Resolve the form server-side from the link credential only ---
    let formId: number | null = null;
    let inviteId: number | null = null;
    let invitePrefill: AnswerMap = {};
    let allowMultiple = false;
    let thankYouEn: string | null = null;
    let thankYouHe: string | null = null;
    let reviewLinkUrl: string | null = null;
    let reviewMinAvg: number | null = null;

    if (input.token) {
      const { data: invite } = await invitesTable()
        .select("id,form_id,submitted_at,multi_use,prefill")
        .eq("token", input.token)
        .maybeSingle();
      if (!invite) return { ok: false, message: t.sendFailed };
      inviteId = invite.id;
      formId = invite.form_id;
      invitePrefill = (invite.prefill ?? {}) as AnswerMap;

      const { data: form } = await formsTable()
        .select(
          "id,status,is_deleted,allow_multiple,thank_you_en,thank_you_he,review_link_url,review_min_avg",
        )
        .eq("id", invite.form_id)
        .maybeSingle();
      if (!form || form.is_deleted || form.status !== "live") {
        return { ok: false, message: t.closed };
      }
      allowMultiple = Boolean(form.allow_multiple);
      thankYouEn = form.thank_you_en;
      thankYouHe = form.thank_you_he;
      reviewLinkUrl = form.review_link_url;
      reviewMinAvg = form.review_min_avg;

      if (invite.submitted_at && !allowMultiple && !invite.multi_use) {
        return { ok: false, message: t.alreadySubmitted };
      }
    } else if (input.slug) {
      const { data: form } = await formsTable()
        .select(
          "id,status,is_deleted,allow_multiple,thank_you_en,thank_you_he,review_link_url,review_min_avg",
        )
        .eq("slug", input.slug)
        .maybeSingle();
      if (!form || form.is_deleted || form.status !== "live") {
        return { ok: false, message: t.closed };
      }
      formId = form.id;
      thankYouEn = form.thank_you_en;
      thankYouHe = form.thank_you_he;
      reviewLinkUrl = form.review_link_url;
      reviewMinAvg = form.review_min_avg;
    }

    if (!formId) return { ok: false, message: t.sendFailed };

    // --- Rate limit. Serverless instances share no memory, so count in the DB ---
    const ip = await clientIp();
    if (ip) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await responsesTable()
        .select("id", { count: "exact", head: true })
        .eq("form_id", formId)
        .eq("ip", ip)
        .gte("submitted_at", since);
      if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
        return { ok: false, message: t.sendFailed };
      }
    }

    // --- Validate against the stored field definitions ---
    const fields = await loadFields(formId);
    const result = validateAnswers(fields, raw, lang);
    if (!result.ok) {
      return { ok: false, message: t.fixErrors, errors: result.errors };
    }

    // Staff-only answers (escort name, trip code…) come exclusively from the
    // invite's prefill - validateAnswers already dropped any client-sent value.
    for (const field of fields) {
      if (!field.staff_only) continue;
      const key = String(field.id);
      if (invitePrefill[key] !== undefined && invitePrefill[key] !== null) {
        result.values[key] = invitePrefill[key];
      }
    }

    const h = await headers();
    const { error } = await responsesTable().insert({
      form_id: formId,
      invite_id: inviteId,
      answers: result.values,
      lang,
      ip,
      user_agent: h.get("user-agent")?.slice(0, 500) ?? null,
    });

    if (error) {
      console.error("submitFormResponse insert failed:", JSON.stringify(error));
      return { ok: false, message: t.sendFailed };
    }

    if (inviteId) {
      await invitesTable()
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", inviteId);
    }

    revalidatePath(`/forms/${formId}/responses`);
    const custom =
      lang === "he" ? thankYouHe || thankYouEn : thankYouEn || thankYouHe;

    // Review gate: the average of the scored rating pool decides whether the
    // thank-you screen offers the external review link. Pool = rating fields
    // flagged config.review_score (none flagged → all rating fields). Only
    // ANSWERED values count - hidden conditional ratings were dropped by
    // validation and unanswered optional ones do not drag the average down.
    let reviewLink: string | null = null;
    if (reviewLinkUrl) {
      const ratings = fields.filter(
        (field) => field.type === "rating" && !field.staff_only,
      );
      const flagged = ratings.filter((field) => field.config.review_score === true);
      const pool = flagged.length > 0 ? flagged : ratings;
      const answered = pool
        .map((field) => result.values[String(field.id)])
        .filter((value): value is number => typeof value === "number");
      const minAvg =
        typeof reviewMinAvg === "number" && reviewMinAvg >= 1 && reviewMinAvg <= 5
          ? reviewMinAvg
          : 5;
      if (answered.length > 0) {
        const avg = answered.reduce((sum, value) => sum + value, 0) / answered.length;
        if (avg >= minAvg) reviewLink = reviewLinkUrl;
      }
    }

    return { ok: true, thankYou: custom?.trim() || t.thankYou, reviewLink };
  } catch (e) {
    console.error("submitFormResponse failed:", e);
    return { ok: false, message: t.sendFailed };
  }
}

/** Staff/operator: every response for a form, with the invite recipient when there is one. */
export async function getFormResponses(
  formId: number,
): Promise<FormResponseRow[]> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  const { data, error } = await responsesTable()
    .select(
      "id,form_id,invite_id,answers,lang,submitted_at,form_invites(recipient_name,recipient_email)",
    )
    .eq("form_id", formId)
    .order("submitted_at", { ascending: false });

  if (error) {
    console.error("getFormResponses failed:", JSON.stringify(error));
    throw error;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    form_id: row.form_id,
    invite_id: row.invite_id,
    answers: (row.answers ?? {}) as AnswerMap,
    lang: row.lang as FormLang,
    ip: null,
    user_agent: null,
    submitted_at: row.submitted_at,
    recipient_name: row.form_invites?.recipient_name ?? null,
    recipient_email: row.form_invites?.recipient_email ?? null,
  }));
}

export async function deleteFormResponse(
  id: number,
  formId: number,
): Promise<boolean> {
  await requireStaff();
  const { error } = await responsesTable().delete().eq("id", id);
  if (error) {
    console.error("deleteFormResponse failed:", JSON.stringify(error));
    throw error;
  }
  await logAudit({
    action: "delete",
    entityType: "form_response",
    entityId: id,
  });
  revalidatePath(`/forms/${formId}/responses`);
  return true;
}
