/**
 * WhatsApp Cloud API - sending from a company's OWN number, the way Alon asked for on 15.10 ("the system sends
 * the customer the message from the WhatsApp it is connected to"), in COEXISTENCE with the WhatsApp Business app
 * since 21.10 (spec docs/superpowers/specs/2026-10-21-whatsapp-cloud-api-design.md, section 7). Off until
 * configured: with no token, or no connected number (wa_accounts) and no env phone id, every caller falls back to
 * opening the rep's own WhatsApp (whatsapp:// / wa.me).
 *
 * The Graph calls live in lib/whatsapp/meta-provider.ts behind `WaProvider`; this file resolves the company's
 * credentials, records every send in wa_messages (status `accepted` BEFORE the call, `sent` with Meta's id or
 * `failed` with the error after), audits `whatsapp.sent` with ids only, and paces sends at SENDS_PER_SECOND per
 * company. Server only.
 *
 * Env (server only, never typed by Claude - Dor sets them in Vercel):
 *   NEXT_SECRET_WHATSAPP_TOKEN              permanent system-user token with whatsapp_business_messaging
 *   NEXT_SECRET_WHATSAPP_TOKEN_<SLUG>       a company's own token, when it has one (wins over the shared one)
 *   NEXT_SECRET_WHATSAPP_PHONE_ID_<SLUG>    the company's phone-number id when no wa_accounts row names one;
 *                                           slug upper-cased, non-alphanumerics "_" (mega-family -> ..._MEGA_FAMILY)
 *   NEXT_SECRET_WHATSAPP_LINK_TEMPLATE      approved template for the booking link (default "booking_link"),
 *                                           Hebrew, body with three variables: {{1}} first name,
 *                                           {{2}} tour, {{3}} the link
 *   NEXT_PUBLIC_WHATSAPP_APP_ID + NEXT_SECRET_WHATSAPP_APP_SECRET   our Meta app, for the Embedded Signup code exchange
 *
 * A business may write first only with an approved TEMPLATE (free text works only inside the 24 h after the
 * customer wrote - `sendText` enforces it), so the booking link goes out as one.
 */
import { randomUUID } from "node:crypto";
import type { Company } from "@/lib/company";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { phoneKey } from "@/lib/tours/cases";
import { WA_TEXT_MAX, canSendText } from "@/lib/whatsapp/rules";
import { phoneIdFor, tokenFor } from "@/lib/whatsapp/env";
import {
  RateGate,
  mediaStoragePath,
  metaProvider,
  providerFor,
  templateBlock,
  type Config,
  type SendResult,
  type TemplateArgs,
  type WaProvider,
} from "@/lib/whatsapp/meta-provider";
import { accountOfCompany, companyById, finishSend, insertMessage, listTemplates as cachedTemplates, type WaAccount } from "@/lib/services/whatsapp-db";

export type { Config, SendResult, TemplateArgs, WaProvider } from "@/lib/whatsapp/meta-provider";
export { metaProvider, providerFor } from "@/lib/whatsapp/meta-provider";

const DEFAULT_LINK_TEMPLATE = "booking_link";
const MEDIA_BUCKET = "wa-media";
/** Spec section 7: at most this many sends a second per company inside one process. */
const SENDS_PER_SECOND = 5;
const gate = new RateGate(SENDS_PER_SECOND);

const isInternational = (to: string): boolean => /^\d{11,15}$/.test(to);
const nowIso = (): string => new Date().toISOString();

export type Sender = { cfg: Config; provider: WaProvider; account: WaAccount | null };

/**
 * The company's sending setup: the token from env, the phone-number id from the connected account (wa_accounts)
 * else from env, the provider the account names (meta when none). An `error` is the sentence staff see.
 */
export async function resolveSender(company: Company): Promise<Sender | { error: string }> {
  const token = tokenFor(company.slug);
  if (!token) return { error: "The WhatsApp sending token is not set in Vercel." };
  const account = await accountOfCompany(company.id);
  const phoneId = account?.phoneNumberId ?? phoneIdFor(company.slug);
  if (!phoneId) return { error: "The company's WhatsApp number is not connected yet." };
  const providerName = account?.provider ?? "meta";
  const provider = providerFor(providerName);
  if (!provider) return { error: `The WhatsApp provider "${providerName}" is not supported by this build.` };
  return { cfg: { token, phoneId }, provider, account };
}

/** The company can send from its own number. */
export async function whatsappApiReady(company: Company): Promise<boolean> {
  try {
    return !("error" in (await resolveSender(company)));
  } catch (e) {
    console.error("whatsapp-cloud: readiness read failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Who and what a send is for - the wa_messages row and the audit row carry it (ids only, never the text). */
export type SendMeta = {
  /** api (staff from the card) | automation | broadcast */
  origin?: string;
  sentBy?: string | null;
  customerId?: string | null;
  caseId?: string | null;
};

type Outgoing = SendMeta & {
  to: string;
  type: "template" | "text";
  text: string | null;
  template: { name: string; language: string; params: string[] } | null;
};

/** Records the row, paces, sends, records the outcome, audits a success. The row is written BEFORE the call. */
async function recordAndSend(company: Company, out: Outgoing, call: () => Promise<SendResult>): Promise<SendResult> {
  const origin = out.origin ?? "api";
  const pending = await insertMessage({
    companyId: company.id,
    waMessageId: `local:${randomUUID()}`,
    phone: out.to,
    phoneKey: phoneKey(out.to),
    customerId: out.customerId ?? null,
    caseId: out.caseId ?? null,
    direction: "out",
    origin,
    type: out.type,
    text: out.text,
    media: null,
    template: out.template,
    status: "accepted",
    sentBy: out.sentBy ?? null,
    sentAt: nowIso(),
  });
  await gate.take(company.id);
  const answer = await call();
  if (pending.id) {
    const at = nowIso();
    await finishSend(pending.id, answer.ok ? { waMessageId: answer.messageId ?? undefined, status: "sent", error: null, at } : { status: "failed", error: answer.error, at }).catch((e: unknown) =>
      console.error("whatsapp-cloud: outcome not recorded:", e instanceof Error ? e.message : e),
    );
    if (answer.ok) {
      await logAudit({
        action: "whatsapp.sent",
        entityType: "wa_message",
        entityId: pending.id,
        metadata: {
          company_id: company.id,
          origin,
          ...(out.template ? { template: out.template.name } : {}),
          case_id: out.caseId ?? null,
          customer_id: out.customerId ?? null,
          wa_message_id: answer.messageId,
        },
      });
    }
  }
  return answer;
}

const failed = (what: string, e: unknown): SendResult => {
  console.error(`whatsapp-cloud: ${what} failed:`, e instanceof Error ? e.message : e);
  return { ok: false, error: e instanceof Error ? e.message : `${what} failed` };
};

/** Sends one approved template to an international number (digits only, e.g. 972528968912). */
export async function sendTemplate(
  company: Company,
  args: { to: string; template?: string; params: string[]; language?: string } & SendMeta,
): Promise<SendResult> {
  try {
    if (!isInternational(args.to)) return { ok: false, error: "The customer's phone is not a valid international number." };
    const sender = await resolveSender(company);
    if ("error" in sender) return { ok: false, error: sender.error };
    const template = args.template ?? (process.env.NEXT_SECRET_WHATSAPP_LINK_TEMPLATE?.trim() || DEFAULT_LINK_TEMPLATE);
    const language = args.language ?? "he";
    const blocked = templateBlock(await cachedTemplates(company.id), template, language);
    if (blocked) return { ok: false, error: blocked };
    const targs: TemplateArgs = { to: args.to, template, params: args.params, language };
    return await recordAndSend(
      company,
      { ...args, type: "template", text: null, template: { name: template, language, params: args.params } },
      () => sender.provider.sendTemplate(sender.cfg, targs),
    );
  } catch (e) {
    return failed("template send", e);
  }
}

/**
 * A free-text message - only inside the 24-hour window after the customer last wrote (`lastInAt`, the customer's
 * `wa_last_in_at`); outside it a template is the only way. Used by the opt-out confirmation now, by the card's
 * reply box later.
 */
export async function sendText(company: Company, args: { to: string; text: string; lastInAt: string | null } & SendMeta): Promise<SendResult> {
  try {
    if (!isInternational(args.to)) return { ok: false, error: "The customer's phone is not a valid international number." };
    const text = args.text.trim().slice(0, WA_TEXT_MAX);
    if (!text) return { ok: false, error: "There is nothing to send." };
    if (!canSendText(args.lastInAt, nowIso())) return { ok: false, error: "More than 24 hours since the customer wrote - send a template." };
    const sender = await resolveSender(company);
    if ("error" in sender) return { ok: false, error: sender.error };
    return await recordAndSend(company, { ...args, type: "text", text, template: null }, () => sender.provider.sendText(sender.cfg, { to: args.to, text }));
  } catch (e) {
    return failed("text send", e);
  }
}

/**
 * Downloads one of Meta's media (an inbound picture, file, voice note) into the private `wa-media` bucket at
 * <companyId>/<mediaId>.<ext>; the storage path, or null when it could not be fetched (the message is stored
 * without it - Meta keeps media only briefly, so this is tried once, at arrival).
 */
export async function storeMedia(account: WaAccount, mediaId: string, mime: string): Promise<string | null> {
  try {
    const company = await companyById(account.companyId);
    if (!company) return null;
    const token = tokenFor(company.slug);
    if (!token) {
      console.warn(`whatsapp-cloud: no token for ${company.slug} - media ${mediaId} not stored`);
      return null;
    }
    const provider = providerFor(account.provider);
    if (!provider) return null;
    const media = await provider.downloadMedia(token, mediaId);
    if (!media) return null;
    const contentType = media.mime || mime || "application/octet-stream";
    const path = mediaStoragePath(account.companyId, mediaId, contentType);
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, media.bytes, { contentType, upsert: true });
    if (error) {
      console.error(`whatsapp-cloud: media ${mediaId} upload failed: ${error.message}`);
      return null;
    }
    return path;
  } catch (e) {
    console.error(`whatsapp-cloud: media ${mediaId} not stored:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Embedded Signup's code for a business token - the token is returned to the caller alone, never stored here. */
export async function exchangeSignupCode(code: string): Promise<{ token: string } | { error: string }> {
  const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID?.trim();
  const appSecret = process.env.NEXT_SECRET_WHATSAPP_APP_SECRET?.trim();
  if (!appId || !appSecret) return { error: "NEXT_PUBLIC_WHATSAPP_APP_ID / NEXT_SECRET_WHATSAPP_APP_SECRET are not set in Vercel." };
  return metaProvider.exchangeCode({ appId, appSecret, code });
}
