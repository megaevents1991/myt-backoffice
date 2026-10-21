"use server";

/**
 * The card's WhatsApp actions (spec 2026-10-21 section 8): mark a card's thread seen (the unseen count, the board
 * chip and the TODAY reason read leads.wa_seen_at), page older messages, and a staff decision on a customer's
 * marketing consent with a note. Every action is scoped to the caller's company; a card is marked seen only when
 * the viewer may see it. Sending from the card is phase 2.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { assertCardVisible } from "@/lib/services/tours-board-viewer";
import { actionFail, actionOk, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import type { WaThreadMessage } from "@/lib/tours/cases";
import { customerWa, setCustomerFields } from "@/lib/services/whatsapp-db";
import { olderThread } from "@/lib/services/whatsapp-thread";

const SCOPE = "whatsapp-thread-actions";
const NOTE_MIN = 3;
const NOTE_MAX = 300;
const CONSENT_STATES = ["opted_in", "opted_out"] as const;
type ConsentState = (typeof CONSENT_STATES)[number];
const missingColumn = (error: { code?: string; message?: string } | null | undefined): boolean => error?.code === "42703" || error?.code === "PGRST204";

/** The viewer opened the card: its inbound messages up to now are seen. No audit - it is a read receipt. */
export async function markThreadSeen(caseId: string): Promise<ActionResult<{ seenAt: string }>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!UUID.test(caseId)) throw new UserError("The case was not found.");
    await assertCardVisible(session, company, caseId);
    const seenAt = new Date().toISOString();
    const { error } = await supabaseTyped.from("leads").update({ wa_seen_at: seenAt }).eq("company_id", company.id).eq("id", caseId).is("is_deleted", null);
    // before the migration the column is not there: nothing to stamp, nothing to count either
    if (error && !missingColumn(error)) throw new Error(`leads: ${error.message}`);
    return actionOk({ seenAt });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to mark the thread seen");
  }
}

/** The page of messages before `before` (the oldest shown), oldest first. */
export async function loadThreadBefore(customerId: string, before: string): Promise<ActionResult<{ messages: WaThreadMessage[]; hasMore: boolean }>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(customerId)) throw new UserError("The customer was not found.");
    const at = Date.parse(before);
    if (!Number.isFinite(at)) throw new UserError("Bad page marker.");
    return actionOk(await olderThread(company, customerId, new Date(at).toISOString()));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load older messages");
  }
}

/**
 * Staff mark a customer's consent given (a signed form, a call where they asked for offers) or withdrawn. The note
 * says where it came from - it is the record the spam law asks for - and the audit row keeps it with who decided.
 */
export async function setCustomerConsent(customerId: string, state: string, note: string): Promise<ActionResult<{ state: string; source: string; at: string }>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!UUID.test(customerId)) throw new UserError("The customer was not found.");
    if (!CONSENT_STATES.includes(state as ConsentState)) throw new UserError("Consent can be marked given or withdrawn.");
    const clean = note.trim().replace(/\s+/g, " ");
    if (clean.length < NOTE_MIN) throw new UserError(`Write a note of at least ${NOTE_MIN} characters - where the consent came from.`);
    if (clean.length > NOTE_MAX) throw new UserError(`The note is too long (up to ${NOTE_MAX} characters).`);
    const before = await customerWa(company.id, customerId);
    if (!before) throw new UserError("The customer was not found.");
    const at = new Date().toISOString();
    const source = `staff:${session.sub}`;
    await setCustomerFields(customerId, { waConsent: state, waConsentSource: source, waConsentAt: at });
    await logAudit({
      action: "whatsapp.consent",
      entityType: "customer",
      entityId: customerId,
      metadata: { ...companyAudit(company), customer_id: customerId, from: before.waConsent, to: state, note: clean },
    });
    return actionOk({ state, source, at });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to record the consent");
  }
}
