"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase-server";
import {
  requireFormVisible,
  requireFormsAccess,
  requireStaff,
} from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { appOrigin, sendMail } from "@/lib/email";
import { pickLang, fieldAdminLabel } from "@/lib/forms/i18n";
import { buildFieldSchema, isEmptyAnswer } from "@/lib/forms/validation";
import { liveRowsQuery, softDeleteStamp } from "@/lib/forms/soft-delete";
import { departureTripCode, orderDepartures, type SeriesDeparture } from "@/lib/forms/series";
import { escortKey } from "@/lib/forms/report";
import { readDeparture, readGuideNames, readOneSeries, readSeriesDepartures } from "@/lib/services/form-series";
import { fetchPaged } from "@/lib/supabase-paged";
import { resolveLang } from "@/types/form.types";
import type {
  AnswerMap,
  AnswerValue,
  FormField,
  FormInvite,
  FormLang,
  FormSeries,
} from "@/types/form.types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const formsTable = () => (supabase as any).from("forms");
const invitesTable = () => (supabase as any).from("form_invites");
/* eslint-enable @typescript-eslint/no-explicit-any */

const INVITE_COLUMNS =
  "id,form_id,token,recipient_name,recipient_email,recipient_phone,lang," +
  "multi_use,label,trip_code_prefix,trip_code_num,total_travelers,prefill,reservation_id,event_id," +
  "sent_at,opened_at,submitted_at,send_error,created_at";

/**
 * A trip of more than a couple thousand people is a typo, not a trip - the cap
 * keeps a slipped keystroke from poisoning the report's denominator.
 */
const MAX_TOTAL_TRAVELERS = 2000;

/**
 * Staff-entered trip size: a whole number, or null for "nobody has said".
 * Anything else (text, negative, fractional, absurd) is rejected rather than
 * quietly coerced, because this number is a report denominator.
 */
function parseTotalTravelers(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0 || n > MAX_TOTAL_TRAVELERS) {
    throw new Error(
      `Total travellers: a whole number between 0 and ${MAX_TOTAL_TRAVELERS}`,
    );
  }
  return n;
}

/** One recipient sent at a time keeps a bad address from aborting the batch. */
const MAX_RECIPIENTS_PER_SEND = 200;

const EMAIL_COPY = {
  en: {
    subject: (title: string) => `Please fill in: ${title}`,
    greeting: (name: string | null) => (name ? `Hi ${name},` : "Hi,"),
    body: "We'd love a few details about your trip so we can put together the right offer for you. It takes about two minutes.",
    cta: "Open the form",
    signoff: "Thanks,<br/>MYT - Mega Events",
  },
  he: {
    subject: (title: string) => `נשמח שתמלאו: ${title}`,
    greeting: (name: string | null) => (name ? `היי ${name},` : "היי,"),
    body: "נשמח לכמה פרטים על הטיול שלכם כדי שנוכל להרכיב עבורכם את ההצעה המתאימה. לוקח בערך שתי דקות.",
    cta: "למילוי הטופס",
    signoff: "תודה,<br/>MYT - מגה אירועים",
  },
} as const;

function inviteEmailHtml(params: {
  lang: FormLang;
  title: string;
  recipientName: string | null;
  url: string;
}): string {
  const copy = EMAIL_COPY[params.lang];
  const rtl = params.lang === "he";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";

  return `<!doctype html>
<html dir="${dir}" lang="${params.lang}">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;" cellpadding="0" cellspacing="0" dir="${dir}">
          <tr><td style="text-align:${align};font-size:20px;font-weight:bold;color:#111827;padding-bottom:8px;">${escapeHtml(params.title)}</td></tr>
          <tr><td style="text-align:${align};font-size:15px;color:#374151;padding-bottom:16px;">${copy.greeting(params.recipientName ? escapeHtml(params.recipientName) : null)}</td></tr>
          <tr><td style="text-align:${align};font-size:15px;color:#374151;line-height:1.6;padding-bottom:24px;">${copy.body}</td></tr>
          <tr><td style="text-align:${align};padding-bottom:24px;">
            <a href="${params.url}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">${copy.cta}</a>
          </td></tr>
          <tr><td style="text-align:${align};font-size:13px;color:#6b7280;line-height:1.6;">${copy.signoff}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const newToken = () => randomBytes(16).toString("hex");

export async function getFormInvites(formId: number): Promise<FormInvite[]> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);
  // A trip link removed from the report is gone from this list too.
  const { data, error } = await liveRowsQuery((filterDeleted) => {
    let query = invitesTable().select(INVITE_COLUMNS).eq("form_id", formId);
    if (filterDeleted) query = query.is("is_deleted", null);
    return query.order("created_at", { ascending: false });
  });

  if (error) {
    console.error("getFormInvites failed:", JSON.stringify(error));
    throw error;
  }
  return (data ?? []) as FormInvite[];
}

export type TripLinkDeparture = SeriesDeparture & {
  /** The trip code a link for it gets ("BBC" + "703"). */
  prefix: string;
  num: string;
  /** Trip links of THIS form already made for it (picked, or typed with the same code). */
  links: number;
};

export type TripLinkOptions = {
  /** The series the form belongs to; null = a general form (every series is listed). */
  series: FormSeries | null;
  /** Recent departures first (newest first), then the coming ones (soonest first). */
  departures: TripLinkDeparture[];
  /** Escort names already used on trip links + the guides list, for the escort box. */
  escorts: string[];
  /** Set when the departures could not be read - the card still works by hand. */
  error: string | null;
};

const ESCORTS_MAX = 500;

/**
 * What the trip-link card offers: the departures to pick from and the escort names to
 * suggest - ONE action, so the invites page pays one guard and one round trip.
 */
export async function getTripLinkOptions(formId: number): Promise<TripLinkOptions> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  const { data: form } = await liveRowsQuery((withSeries) =>
    formsTable().select(withSeries ? "id,series_id" : "id").eq("id", formId).maybeSingle(),
  );
  const seriesId: string | null = form?.series_id ?? null;

  const [seriesRes, departuresRes, linksRes, escorts] = await Promise.all([
    seriesId ? readOneSeries(seriesId).catch(() => null) : Promise.resolve(null),
    readSeriesDepartures(seriesId).then(
      (rows) => ({ rows, error: null as string | null }),
      (e: unknown) => ({
        rows: [] as SeriesDeparture[],
        error: e instanceof Error ? e.message : "Could not read the departures",
      }),
    ),
    liveRowsQuery((withDeparture) =>
      liveRowsQuery((filterDeleted) => {
        let query = invitesTable()
          .select(
            withDeparture
              ? "id,trip_code_prefix,trip_code_num,departure_id"
              : "id,trip_code_prefix,trip_code_num",
          )
          .eq("form_id", formId)
          .eq("multi_use", true);
        if (filterDeleted) query = query.is("is_deleted", null);
        return query;
      }),
    ),
    escortSuggestions(actor.role === "forms_operator"),
  ]);

  const links = (linksRes.data ?? []) as {
    trip_code_prefix: string | null;
    trip_code_num: string | null;
    departure_id?: string | null;
  }[];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const departures: TripLinkDeparture[] = [];
  for (const d of orderDepartures(departuresRes.rows, today)) {
    const code = departureTripCode(d);
    if (!code) continue;
    departures.push({
      ...d,
      prefix: code.prefix,
      num: code.num,
      links: links.filter(
        (l) =>
          l.departure_id === d.id ||
          (!l.departure_id && l.trip_code_prefix === code.prefix && l.trip_code_num === code.num),
      ).length,
    });
  }

  return { series: seriesRes, departures, escorts, error: departuresRes.error };
}

/**
 * Escort names already typed on any trip link (the first staff short-text answer - the
 * report's escort rule) plus the guides list, one spelling per escort, A to Z. A hint only:
 * a failed read suggests nothing.
 */
async function escortSuggestions(operatorOnly: boolean): Promise<string[]> {
  try {
    // An operator hears only the names on forms opened to them - the same rule as the list.
    let visible: Set<number> | null = null;
    if (operatorOnly) {
      const { data, error } = await formsTable().select("id").eq("operator_visible", true);
      if (error) throw error;
      visible = new Set(((data ?? []) as { id: number }[]).map((f) => f.id));
    }
    const [fieldsRes, invites, guides] = await Promise.all([
      (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("form_fields")
        .select("id,form_id,position")
        .eq("staff_only", true)
        .eq("type", "short_text")
        .order("form_id", { ascending: true })
        .order("position", { ascending: true })
        .limit(1000),
      fetchPaged<{ id: number; form_id: number; prefill: AnswerMap | null }>(
        () =>
          invitesTable()
            .select("id,form_id,prefill")
            .eq("multi_use", true)
            .order("id", { ascending: true }),
        5000,
      ),
      // The guides list is staff's; an operator gets the names on their own forms only.
      operatorOnly ? Promise.resolve([] as string[]) : readGuideNames(),
    ]);
    const escortField = new Map<number, number>();
    for (const f of (fieldsRes.data ?? []) as { id: number; form_id: number }[]) {
      if (!escortField.has(f.form_id)) escortField.set(f.form_id, f.id);
    }
    const byKey = new Map<string, string>();
    const add = (name: unknown) => {
      if (typeof name !== "string") return;
      const clean = name.replace(/\s+/g, " ").trim();
      const key = escortKey(clean);
      if (key && !byKey.has(key)) byKey.set(key, clean);
    };
    for (const invite of invites.rows) {
      if (visible && !visible.has(invite.form_id)) continue;
      const fieldId = escortField.get(invite.form_id);
      if (fieldId) add(invite.prefill?.[String(fieldId)]);
    }
    for (const name of guides) add(name);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, "he")).slice(0, ESCORTS_MAX);
  } catch (e) {
    console.error("escortSuggestions failed:", e);
    return [];
  }
}

export type InviteRecipient = {
  name: string | null;
  email: string;
  lang: FormLang;
};

export type SendInvitesResult = {
  sent: number;
  failed: { email: string; error: string }[];
};

/**
 * Create one invite per recipient and email each a unique link.
 *
 * Sends are sequential with per-recipient try/catch: the invite row is always
 * written, so a failed send can be retried from the invites table instead of
 * losing the recipient.
 */
export async function createAndSendInvites(
  formId: number,
  recipients: InviteRecipient[],
): Promise<SendInvitesResult> {
  await requireStaff();

  const { data: form, error: formError } = await formsTable()
    .select("id,title_en,title_he,status,is_deleted,languages,default_lang")
    .eq("id", formId)
    .maybeSingle();

  if (formError) throw formError;
  if (!form || form.is_deleted) throw new Error("Form not found");
  if (form.status !== "live") {
    throw new Error("Publish the form before sending invites");
  }

  const clean = recipients
    .map((r) => ({
      name: r.name?.trim() || null,
      email: r.email?.trim().toLowerCase() ?? "",
      // A single-language form can only be sent in that language.
      lang: resolveLang(
        form.languages,
        r.lang === "he" ? "he" : "en",
        (form.default_lang as FormLang) ?? "en",
      ),
    }))
    .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
    .slice(0, MAX_RECIPIENTS_PER_SEND);

  if (clean.length === 0) throw new Error("No valid email addresses");

  const origin = appOrigin();
  const result: SendInvitesResult = { sent: 0, failed: [] };

  for (const recipient of clean) {
    const token = newToken();

    const { data: inserted, error } = await invitesTable()
      .insert({
        form_id: formId,
        token,
        recipient_name: recipient.name,
        recipient_email: recipient.email,
        lang: recipient.lang,
      })
      .select("id");

    if (error) {
      console.error(
        "createAndSendInvites insert failed:",
        JSON.stringify(error),
      );
      result.failed.push({
        email: recipient.email,
        error: "Could not create invite",
      });
      continue;
    }

    const inviteId = inserted?.[0]?.id as number | undefined;
    const title = pickLang(form.title_en, form.title_he, recipient.lang);
    const url = `${origin}/f/i/${token}?lang=${recipient.lang}`;

    try {
      await sendMail({
        to: recipient.email,
        subject: EMAIL_COPY[recipient.lang].subject(title),
        html: inviteEmailHtml({
          lang: recipient.lang,
          title,
          recipientName: recipient.name,
          url,
        }),
        text: `${title}\n\n${url}`,
      });
      if (inviteId) {
        await invitesTable()
          .update({ sent_at: new Date().toISOString(), send_error: null })
          .eq("id", inviteId);
      }
      result.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Send failed";
      console.error(`invite send failed for ${recipient.email}:`, message);
      if (inviteId) {
        await invitesTable()
          .update({ send_error: message.slice(0, 300) })
          .eq("id", inviteId);
      }
      result.failed.push({ email: recipient.email, error: message });
    }
  }

  await logAudit({
    action: "send",
    entityType: "form_invites",
    entityId: formId,
    metadata: { sent: result.sent, failed: result.failed.length },
  });
  revalidatePath(`/forms/${formId}/invites`);
  return result;
}

export async function resendInvite(inviteId: number): Promise<boolean> {
  await requireStaff();

  const { data: invite, error } = await invitesTable()
    .select("id,form_id,token,recipient_name,recipient_email,lang")
    .eq("id", inviteId)
    .maybeSingle();

  if (error) throw error;
  if (!invite?.recipient_email) throw new Error("Invite has no email address");

  const { data: form } = await formsTable()
    .select("title_en,title_he,status,is_deleted")
    .eq("id", invite.form_id)
    .maybeSingle();

  if (!form || form.is_deleted || form.status !== "live") {
    throw new Error("Form is not live");
  }

  const lang = (invite.lang as FormLang) ?? "en";
  const title = pickLang(form.title_en, form.title_he, lang);
  const url = `${appOrigin()}/f/i/${invite.token}?lang=${lang}`;

  try {
    await sendMail({
      to: invite.recipient_email,
      subject: EMAIL_COPY[lang].subject(title),
      html: inviteEmailHtml({
        lang,
        title,
        recipientName: invite.recipient_name,
        url,
      }),
      text: `${title}\n\n${url}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Send failed";
    await invitesTable()
      .update({ send_error: message.slice(0, 300) })
      .eq("id", inviteId);
    throw new Error(message);
  }

  await invitesTable()
    .update({ sent_at: new Date().toISOString(), send_error: null })
    .eq("id", inviteId);

  revalidatePath(`/forms/${invite.form_id}/invites`);
  return true;
}

/**
 * Create a TRIP LINK: one multi-use token for a whole travel group.
 *
 * The escort's staff-only answers (escort name, trip code, departure date…)
 * are validated against the field definitions and stored on the invite's
 * `prefill`; the submit action merges them into every response that comes
 * through this token. Clients never see these fields or values.
 */
export async function createTripLink(
  formId: number,
  input: {
    tripCodePrefix: string;
    tripCodeNum: string;
    lang: FormLang;
    staffAnswers: AnswerMap;
    /** How many travellers are on the trip; optional, editable later. */
    totalTravelers?: number | string | null;
    /**
     * The tours departure picked from the list. Its OWN code and date win over what the
     * client sent - the browser only names it.
     */
    departureId?: string | null;
  },
): Promise<{ url: string; invite: FormInvite }> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  const departure = input.departureId ? await readDeparture(String(input.departureId)) : null;
  if (input.departureId && !departure) throw new Error("Departure not found");
  if (departure) {
    // A series form takes its own series' departures only; a general form takes any.
    const { data: owner } = await liveRowsQuery((withSeries) =>
      formsTable().select(withSeries ? "id,series_id" : "id").eq("id", formId).maybeSingle(),
    );
    const formSeries: string | null = owner?.series_id ?? null;
    if (formSeries && departure.series_id !== formSeries) {
      throw new Error("This departure belongs to another series than the form");
    }
  }
  const fromDeparture = departure ? departureTripCode(departure) : null;
  if (departure && !fromDeparture) throw new Error("This departure has no trip code - type it by hand");

  // Trip identity: free letters + digits, normalized once here so the report
  // groups "bbc-1" and "BBC-1" as the same trip.
  const prefix = (fromDeparture?.prefix ?? input.tripCodePrefix ?? "").trim().toUpperCase();
  const num = (fromDeparture?.num ?? input.tripCodeNum ?? "").trim();
  if (!/^[A-Z]{1,8}$/.test(prefix)) {
    throw new Error("Trip code letters: 1-8 English letters");
  }
  if (!/^\d{1,8}$/.test(num)) {
    throw new Error("Trip code number: digits only");
  }
  const totalTravelers = parseTotalTravelers(input.totalTravelers);

  const { data: form, error: formError } = await formsTable()
    .select("id,is_deleted,languages,default_lang")
    .eq("id", formId)
    .maybeSingle();
  if (formError) throw formError;
  if (!form || form.is_deleted) throw new Error("Form not found");

  const { data: staffFields, error: fieldsError } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("form_fields")
    .select("id,form_id,type,label_en,label_he,required,staff_only,options,config")
    .eq("form_id", formId)
    .eq("staff_only", true)
    .order("position", { ascending: true });
  if (fieldsError) {
    console.error("createTripLink fields failed:", JSON.stringify(fieldsError));
    throw fieldsError;
  }

  // Only staff-field ids may land in prefill, and each value must satisfy the
  // field's own schema - the same rules a client submission faces.
  // A picked departure dates the trip: the first staff date question is the departure
  // (the report reads it by the same rule) - filled when staff left it empty.
  const staffAnswers: AnswerMap = { ...(input.staffAnswers ?? {}) };
  const dateField = ((staffFields ?? []) as FormField[]).find((field) => field.type === "date");
  if (departure && dateField && isEmptyAnswer(staffAnswers[String(dateField.id)])) {
    staffAnswers[String(dateField.id)] = departure.start_date;
  }

  const prefill: AnswerMap = {};
  for (const field of (staffFields ?? []) as FormField[]) {
    const key = String(field.id);
    const value = staffAnswers[key];
    if (isEmptyAnswer(value)) {
      if (field.required) {
        throw new Error(`Missing: ${fieldAdminLabel(field)}`);
      }
      continue;
    }
    const schema = buildFieldSchema(field);
    if (!schema) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Invalid value for: ${fieldAdminLabel(field)}`);
    }
    prefill[key] = parsed.data as AnswerValue;
  }

  const lang = resolveLang(
    form.languages,
    input.lang === "he" ? "he" : "en",
    (form.default_lang as FormLang) ?? "en",
  );

  const token = newToken();
  const row = {
    form_id: formId,
    token,
    lang,
    multi_use: true,
    label: `${prefix}-${num}`,
    trip_code_prefix: prefix,
    trip_code_num: num,
    total_travelers: totalTravelers,
    prefill,
  };
  let { data, error } = await invitesTable()
    .insert(departure ? { ...row, departure_id: departure.id } : row)
    .select(INVITE_COLUMNS);
  if (departure && error && (error.code === "42703" || error.code === "PGRST204")) {
    // departure_id waits for its migration; the link itself does not.
    ({ data, error } = await invitesTable().insert(row).select(INVITE_COLUMNS));
  }

  if (error) {
    console.error("createTripLink failed:", JSON.stringify(error));
    throw error;
  }

  await logAudit({
    action: "create",
    entityType: "form_invite",
    entityId: (data[0] as FormInvite).id,
    metadata: { trip_link: true, trip_code: `${prefix}-${num}`, departure_id: departure?.id ?? null },
  });
  revalidatePath(`/forms/${formId}/invites`);
  return {
    url: `${appOrigin()}/f/i/${token}?lang=${lang}`,
    invite: data[0] as FormInvite,
  };
}

/** Create a link without emailing it - for sending over WhatsApp yourself. */
export async function createInviteLink(
  formId: number,
  recipient: { name: string | null; email: string | null; lang: FormLang },
): Promise<{ url: string; invite: FormInvite }> {
  await requireStaff();

  const token = newToken();
  const { data, error } = await invitesTable()
    .insert({
      form_id: formId,
      token,
      recipient_name: recipient.name?.trim() || null,
      recipient_email: recipient.email?.trim().toLowerCase() || null,
      lang: recipient.lang === "he" ? "he" : "en",
    })
    .select(INVITE_COLUMNS);

  if (error) {
    console.error("createInviteLink failed:", JSON.stringify(error));
    throw error;
  }

  revalidatePath(`/forms/${formId}/invites`);
  return {
    url: `${appOrigin()}/f/i/${token}?lang=${recipient.lang}`,
    invite: data[0] as FormInvite,
  };
}

export type SetTotalTravelersResult =
  | { ok: true; total: number | null }
  | { ok: false; message: string };

/**
 * Set (or clear) how many travellers a trip had, after the link was minted -
 * the usual case, since the group size is often known only once everyone has
 * flown. Staff and operators who can see the form may set it; the value is a
 * plain count and never touches anybody's answers.
 *
 * Returns a result rather than throwing: Next masks thrown Server Action
 * errors in production, and the caller needs the reason to show it inline.
 */
export async function setTripTotalTravelers(
  inviteId: number,
  formId: number,
  total: number | string | null,
): Promise<SetTotalTravelersResult> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  let value: number | null;
  try {
    value = parseTotalTravelers(total);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { data, error } = await invitesTable()
    .update({ total_travelers: value })
    .eq("id", inviteId)
    .eq("form_id", formId)
    .select("id");
  if (error) {
    console.error("setTripTotalTravelers failed:", JSON.stringify(error));
    return { ok: false, message: "Saving failed." };
  }
  if (!data || data.length === 0) return { ok: false, message: "Trip not found." };

  await logAudit({
    action: "update",
    entityType: "form_invite",
    entityId: inviteId,
    changes: { total_travelers: value },
    metadata: { form_id: formId },
  });
  revalidatePath(`/forms/${formId}/invites`);
  revalidatePath(`/forms/${formId}/report`);
  return { ok: true, total: value };
}

export async function deleteInvite(
  inviteId: number,
  formId: number,
): Promise<boolean> {
  await requireStaff();
  const { error } = await invitesTable().delete().eq("id", inviteId);
  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "form_invite",
    entityId: inviteId,
  });
  revalidatePath(`/forms/${formId}/invites`);
  return true;
}

export type TripLinkResult = { ok: true } | { ok: false; message: string };

const missingColumn = (code: string | undefined) =>
  code === "42703" || code === "PGRST204";

/**
 * Staff/operator: remove a trip link nobody needs (a duplicate, a typo in the
 * code or the date) from the trips report and the links list. A SOFT delete -
 * `restoreTripLink` brings it back - and the link stops taking answers
 * meanwhile. Only an EMPTY trip can go: one with live responses keeps its
 * row, so real feedback never disappears with a click on the wrong line
 * (delete its irrelevant responses first, one by one).
 */
export async function deleteTripLink(
  inviteId: number,
  formId: number,
): Promise<TripLinkResult> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  const { data: invite, error: loadError } = await invitesTable()
    .select("id,multi_use,trip_code_prefix,trip_code_num")
    .eq("id", inviteId)
    .eq("form_id", formId)
    .maybeSingle();
  if (loadError) {
    console.error("deleteTripLink load failed:", JSON.stringify(loadError));
    return { ok: false, message: "Could not load the trip." };
  }
  if (!invite || !invite.trip_code_prefix || !invite.trip_code_num) {
    return { ok: false, message: "Trip not found." };
  }

  const { count, error: countError } = await liveRowsQuery((filterDeleted) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from("form_responses")
      .select("id", { count: "exact", head: true })
      .eq("invite_id", inviteId);
    if (filterDeleted) query = query.is("is_deleted", null);
    return query;
  });
  if (countError) {
    console.error("deleteTripLink count failed:", JSON.stringify(countError));
    return { ok: false, message: "Could not check the trip's responses." };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `לטיול יש ${count} משובים - מוחקים אותם קודם, ואז את הטיול.`,
    };
  }

  const code = `${invite.trip_code_prefix}-${invite.trip_code_num}`;
  const { data, error } = await invitesTable()
    .update({ is_deleted: softDeleteStamp() })
    .eq("id", inviteId)
    .eq("form_id", formId)
    .is("is_deleted", null)
    .select("id");
  if (error) {
    console.error("deleteTripLink failed:", JSON.stringify(error));
    return {
      ok: false,
      message: missingColumn(error.code)
        ? "Deleting is not available yet - try again in a few minutes."
        : "Deleting failed.",
    };
  }
  if (!data || data.length === 0) return { ok: false, message: "Trip already deleted." };

  await logAudit({
    action: "delete",
    entityType: "form_invite",
    entityId: inviteId,
    metadata: { form_id: formId, trip_link: true, trip_code: code },
  });
  revalidatePath(`/forms/${formId}/report`);
  revalidatePath(`/forms/${formId}/invites`);
  return { ok: true };
}

/** Undo of `deleteTripLink` - the trip is back in the report and its link answers again. */
export async function restoreTripLink(
  inviteId: number,
  formId: number,
): Promise<TripLinkResult> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  const { data, error } = await invitesTable()
    .update({ is_deleted: null })
    .eq("id", inviteId)
    .eq("form_id", formId)
    .not("is_deleted", "is", null)
    .select("id");
  if (error) {
    console.error("restoreTripLink failed:", JSON.stringify(error));
    return { ok: false, message: "Restoring failed." };
  }
  if (!data || data.length === 0) return { ok: false, message: "Trip not found." };

  await logAudit({
    action: "restore",
    entityType: "form_invite",
    entityId: inviteId,
    metadata: { form_id: formId, trip_link: true },
  });
  revalidatePath(`/forms/${formId}/report`);
  revalidatePath(`/forms/${formId}/invites`);
  return { ok: true };
}

/** Absolute public URL for the shared link, shown in the builder. */
export async function publicFormUrl(slug: string): Promise<string> {
  await requireStaff();
  return `${appOrigin()}/f/${slug}`;
}
