"use server";

/**
 * The WhatsApp card on Settings (spec 2026-10-21 section 8): what is connected, finishing Meta's Embedded Signup,
 * syncing the template cache, a test send to the admin's own phone. Company admins only - the same gate as the
 * settings form (isManagerRole). The signup's business token lives inside finishWhatsappSignup alone: it is used
 * for the subscription, the phone read and the history request, and leaves with the function - tokens are never
 * stored in a table (the sending token is NEXT_SECRET_WHATSAPP_TOKEN in Vercel).
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { isManagerRole } from "@/components/tours/flights/block-rules";
import { actionFail, actionOk, UserError, type ActionResult } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import { whatsappPhone } from "@/lib/tours/cases";
import { parseSignupInput } from "@/lib/whatsapp/rules";
import { tokenFor } from "@/lib/whatsapp/env";
import { exchangeSignupCode, metaProvider, sendTemplate } from "@/lib/services/whatsapp-cloud";
import { accountOfCompany, listTemplates as cachedTemplates, patchAccount, upsertAccount, upsertTemplate, type WaAccount, type WaTemplate } from "@/lib/services/whatsapp-db";

const SCOPE = "whatsapp-settings-actions";
const NOT_ADMIN = "Company admins only.";
const TEST_PARAM = "בדיקה";

export type WhatsappSettings = {
  account: WaAccount | null;
  /** The sending token is set in Vercel (its value never travels). */
  tokenSet: boolean;
  /** What the Embedded Signup button needs; null while NEXT_PUBLIC_WHATSAPP_APP_ID / NEXT_SECRET_WHATSAPP_CONFIG_ID are unset. */
  signup: { appId: string; configId: string } | null;
  templates: WaTemplate[];
  /** The admin's own phone (user profile), international digits - the only number a test may go to. */
  staffPhone: string | null;
};

async function manager() {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) throw new UserError(NOT_ADMIN);
  return { session, company };
}

async function staffPhoneOf(userId: string): Promise<string | null> {
  const { data, error } = await supabaseTyped.from("user_profiles").select("phone").eq("id", userId).maybeSingle();
  if (error) {
    console.warn(`${SCOPE}: user_profiles read failed: ${error.message}`);
    return null;
  }
  return whatsappPhone(data?.phone ?? null);
}

const signupEnv = (): WhatsappSettings["signup"] => {
  const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID?.trim();
  const configId = process.env.NEXT_SECRET_WHATSAPP_CONFIG_ID?.trim();
  return appId && configId ? { appId, configId } : null;
};

export async function getWhatsappSettings(): Promise<ActionResult<WhatsappSettings>> {
  try {
    const { session, company } = await manager();
    const [account, templates, staffPhone] = await Promise.all([accountOfCompany(company.id), cachedTemplates(company.id), staffPhoneOf(session.sub)]);
    return actionOk({ account, tokenSet: tokenFor(company.slug) !== null, signup: signupEnv(), templates, staffPhone });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the WhatsApp settings");
  }
}

/**
 * Meta's Embedded Signup finished in the browser: the code becomes a business token, our app subscribes to the
 * WABA's webhooks, the number is read and stored as the company's account, and - when the admin chose to share the
 * history - the six-month sync is requested (once; Meta allows it within 24 h of the signup).
 */
export async function finishWhatsappSignup(raw: { code: string; phoneNumberId: string; wabaId: string; sharedHistory: boolean }): Promise<ActionResult<WaAccount>> {
  try {
    const { company } = await manager();
    const input = parseSignupInput(raw);
    if (!input.ok) throw new UserError(input.error);
    const exchanged = await exchangeSignupCode(input.code);
    if ("error" in exchanged) throw new UserError(exchanged.error);
    const token = exchanged.token;

    const subscribed = await metaProvider.subscribeApp(token, input.wabaId);
    if (!subscribed.ok) throw new UserError(`The webhook subscription failed: ${subscribed.error}`);
    const info = await metaProvider.phoneInfo(token, input.phoneNumberId);
    if (!info) throw new UserError("Meta did not answer the phone number read - run the signup again.");
    const mode = info.isOnBizApp === true || info.platformType === "SMB" ? "coexistence" : "api_only";

    const account = await upsertAccount({
      companyId: company.id,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhone: info.displayPhone,
      verifiedName: info.verifiedName,
      mode,
      provider: "meta",
      qualityRating: info.qualityRating,
      messagingLimit: null,
      historyRequestedAt: null,
      historySyncedAt: null,
      isActive: true,
    });

    let warning: string | undefined;
    let historyRequestedAt: string | null = account.historyRequestedAt;
    if (input.sharedHistory) {
      const history = await metaProvider.requestHistorySync({ token, phoneId: input.phoneNumberId });
      if (history.ok) {
        historyRequestedAt = new Date().toISOString();
        await patchAccount(account.id, { historyRequestedAt });
      } else warning = `The number is connected, but the history sync was not requested: ${history.error}`;
    }
    await logAudit({
      action: "whatsapp.connected",
      entityType: "wa_account",
      entityId: account.id,
      metadata: { ...companyAudit(company), waba_id: input.wabaId, phone_number_id: input.phoneNumberId, mode, shared_history: input.sharedHistory },
    });
    return actionOk({ ...account, historyRequestedAt }, warning);
  } catch (e) {
    return actionFail(e, SCOPE, "The WhatsApp signup did not finish");
  }
}

/** Reads the WABA's templates from Meta into the cache (wa_templates) and answers the cache. */
export async function syncWhatsappTemplates(): Promise<ActionResult<WaTemplate[]>> {
  try {
    const { company } = await manager();
    const account = await accountOfCompany(company.id);
    if (!account) throw new UserError("Connect the company's number first.");
    const token = tokenFor(company.slug);
    if (!token) throw new UserError("The sending token is not set in Vercel.");
    const fetched = await metaProvider.listTemplates(token, account.wabaId);
    for (const t of fetched) await upsertTemplate(company.id, t);
    return actionOk(await cachedTemplates(company.id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to sync the templates");
  }
}

/** One approved template to the admin's OWN phone (the one on their user profile), every variable "בדיקה". */
export async function sendWhatsappTest(input: { to: string; template: string }): Promise<ActionResult<{ messageId: string | null }>> {
  try {
    const { session, company } = await manager();
    const staffPhone = await staffPhoneOf(session.sub);
    const to = whatsappPhone(typeof input?.to === "string" ? input.to : null);
    if (!staffPhone || !to || to !== staffPhone) throw new UserError("A test goes to your own phone only - the one on your user profile.");
    const name = typeof input.template === "string" ? input.template.trim() : "";
    const cached = (await cachedTemplates(company.id)).find((t) => t.name === name);
    if (!cached || cached.status !== "APPROVED") throw new UserError("Pick an approved template (sync the templates first).");
    const params = Array.from({ length: cached.paramCount ?? 0 }, () => TEST_PARAM);
    const answer = await sendTemplate(company, { to, template: cached.name, language: cached.language, params, origin: "api", sentBy: session.sub });
    if (!answer.ok) throw new UserError(answer.error);
    return actionOk({ messageId: answer.messageId });
  } catch (e) {
    return actionFail(e, SCOPE, "The test was not sent");
  }
}
