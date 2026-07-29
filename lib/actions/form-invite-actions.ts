"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { appOrigin, sendMail } from "@/lib/email";
import { pickLang } from "@/lib/forms/i18n";
import { resolveLang } from "@/types/form.types";
import type { FormInvite, FormLang } from "@/types/form.types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const formsTable = () => (supabase as any).from("forms");
const invitesTable = () => (supabase as any).from("form_invites");
/* eslint-enable @typescript-eslint/no-explicit-any */

const INVITE_COLUMNS =
  "id,form_id,token,recipient_name,recipient_email,recipient_phone,lang," +
  "prefill,reservation_id,event_id,sent_at,opened_at,submitted_at,send_error,created_at";

/** One recipient sent at a time keeps a bad address from aborting the batch. */
const MAX_RECIPIENTS_PER_SEND = 200;

const EMAIL_COPY = {
  en: {
    subject: (title: string) => `Please fill in: ${title}`,
    greeting: (name: string | null) => (name ? `Hi ${name},` : "Hi,"),
    body: "We'd love a few details about your trip so we can put together the right offer for you. It takes about two minutes.",
    cta: "Open the form",
    signoff: "Thanks,<br/>MYT — Mega Events",
  },
  he: {
    subject: (title: string) => `נשמח שתמלאו: ${title}`,
    greeting: (name: string | null) => (name ? `היי ${name},` : "היי,"),
    body: "נשמח לכמה פרטים על הטיול שלכם כדי שנוכל להרכיב עבורכם את ההצעה המתאימה. לוקח בערך שתי דקות.",
    cta: "למילוי הטופס",
    signoff: "תודה,<br/>MYT — מגה אירועים",
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
  await requireStaff();
  const { data, error } = await invitesTable()
    .select(INVITE_COLUMNS)
    .eq("form_id", formId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getFormInvites failed:", JSON.stringify(error));
    throw error;
  }
  return (data ?? []) as FormInvite[];
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
      console.error("createAndSendInvites insert failed:", JSON.stringify(error));
      result.failed.push({ email: recipient.email, error: "Could not create invite" });
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
        await invitesTable().update({ send_error: message.slice(0, 300) }).eq("id", inviteId);
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
    await invitesTable().update({ send_error: message.slice(0, 300) }).eq("id", inviteId);
    throw new Error(message);
  }

  await invitesTable()
    .update({ sent_at: new Date().toISOString(), send_error: null })
    .eq("id", inviteId);

  revalidatePath(`/forms/${invite.form_id}/invites`);
  return true;
}

/** Create a link without emailing it — for sending over WhatsApp yourself. */
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

export async function deleteInvite(inviteId: number, formId: number): Promise<boolean> {
  await requireStaff();
  const { error } = await invitesTable().delete().eq("id", inviteId);
  if (error) throw error;
  await logAudit({ action: "delete", entityType: "form_invite", entityId: inviteId });
  revalidatePath(`/forms/${formId}/invites`);
  return true;
}

/** Absolute public URL for the shared link, shown in the builder. */
export async function publicFormUrl(slug: string): Promise<string> {
  await requireStaff();
  return `${appOrigin()}/f/${slug}`;
}
