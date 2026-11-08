"use server";

/**
 * The WhatsApp Business app's own automatic texts (greeting / away message) of the company's number - an echo of one
 * is not a rep's answer (spec 2026-11-08 section 5, `wa_app_auto_texts`). Listed, added and removed on the WhatsApp
 * settings tab; "find them" reads what the app sent word for word to many chats. Company admins only.
 */
import { requireCompany } from "@/lib/company";
import { logAudit } from "@/lib/audit";
import { isManagerRole } from "@/components/tours/flights/block-rules";
import { actionFail, actionOk, UserError, type ActionResult } from "@/lib/tours/action-kit";
import { normAutoText, suggestAutoTexts } from "@/lib/whatsapp/events/chat-rules";
import { addAutoTexts, listAutoTextRows, recentEchoes, removeAutoText as removeRow } from "@/lib/services/whatsapp-events-db";
import { getWhatsappSettings, type WhatsappSettings } from "@/lib/actions/whatsapp-settings-actions";
import { whatsappPhone } from "@/lib/tours/cases";

const SCOPE = "whatsapp-auto-text-actions";
const NOT_ADMIN = "Company admins only.";
const TEXT_MAX = 1000;
const LOOKBACK_DAYS = 200;

export type AutoTextRow = { text: string; textNorm: string; source: string };

async function manager() {
  const { session, company } = await requireCompany();
  if (!company.productTypes.includes("events")) throw new UserError(NOT_ADMIN);
  if (!isManagerRole(session.role)) throw new UserError(NOT_ADMIN);
  return { session, company };
}

export async function listAutoTexts(): Promise<ActionResult<AutoTextRow[]>> {
  try {
    const { company } = await manager();
    return actionOk(await listAutoTextRows(company.id));
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

export async function addAutoText(text: string): Promise<ActionResult<AutoTextRow[]>> {
  try {
    const { company } = await manager();
    const clean = normAutoText(typeof text === "string" ? text : "");
    if (!clean) throw new UserError("Paste the text the app sends.");
    if (clean.length > TEXT_MAX) throw new UserError(`At most ${TEXT_MAX} characters.`);
    await addAutoTexts(company.id, [clean], "staff");
    await logAudit({ action: "whatsapp.auto_text", entityType: "company", entityId: company.id, metadata: { op: "add", length: clean.length } });
    return actionOk(await listAutoTextRows(company.id));
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

export async function removeAutoText(textNorm: string): Promise<ActionResult<AutoTextRow[]>> {
  try {
    const { company } = await manager();
    if (typeof textNorm !== "string" || !textNorm) throw new UserError("Nothing to remove.");
    await removeRow(company.id, textNorm);
    await logAudit({ action: "whatsapp.auto_text", entityType: "company", entityId: company.id, metadata: { op: "remove" } });
    return actionOk(await listAutoTextRows(company.id));
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** Reads what the number sent from the app and keeps the texts it sent word for word to five or more chats. */
export async function findAutoTexts(): Promise<ActionResult<AutoTextRow[]>> {
  try {
    const { company } = await manager();
    const found = suggestAutoTexts(await recentEchoes(company.id, LOOKBACK_DAYS));
    if (found.length) await addAutoTexts(company.id, found, "history");
    return actionOk(await listAutoTextRows(company.id), found.length ? undefined : "No repeated text was found yet.");
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

export type EventsWhatsappSettingsTab = {
  settings: WhatsappSettings | null;
  settingsError: string | null;
  autoTexts: AutoTextRow[];
  /** The last 4 digits of the trial phone while NEXT_SECRET_WA_EVENTS_TRIAL_PHONE is set (spec D-7), else null. */
  trialPhoneLast4: string | null;
  /** EVENTS_WHATSAPP_AUTO=off - the automatic messages are stopped. */
  autoOff: boolean;
};

/** The WhatsApp screen's settings tab in ONE read: the connect card, the app's automatic texts, trial and kill switch. */
export async function getEventsWhatsappSettingsTab(): Promise<ActionResult<EventsWhatsappSettingsTab>> {
  try {
    const { company } = await manager();
    const [settings, autoTexts] = await Promise.all([getWhatsappSettings(), listAutoTextRows(company.id)]);
    const trial = whatsappPhone(process.env.NEXT_SECRET_WA_EVENTS_TRIAL_PHONE ?? null);
    return actionOk({
      settings: settings.success ? settings.data ?? null : null,
      settingsError: settings.success ? null : settings.error,
      autoTexts,
      trialPhoneLast4: trial ? trial.slice(-4) : null,
      autoOff: process.env.EVENTS_WHATSAPP_AUTO?.trim().toLowerCase() === "off",
    });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}
