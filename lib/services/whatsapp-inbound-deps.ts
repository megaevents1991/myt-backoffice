/**
 * The real dependencies of the inbound flow (lib/services/whatsapp-inbound.ts `InboundDeps`): the DB boundary
 * (whatsapp-db) plus the two things that touch Meta - storing a media and the one free service reply. The webhook
 * route (app/api/whatsapp/webhook) builds one per batch; scripts/whatsapp-inbound-selftest.ts runs the same flow
 * over stubs. Server only.
 */
import type { Company } from "@/lib/company";
import type { InboundDeps } from "@/lib/services/whatsapp-inbound";
import { sendText, storeMedia } from "@/lib/services/whatsapp-cloud";
import {
  accountByPhoneId,
  accountByWabaId,
  attachOrphans,
  companyById,
  findCustomers,
  insertLead,
  insertMessage,
  knownMessageIds,
  lastInbound,
  linkMessage,
  patchAccount,
  setCustomerFields,
  updateStatus,
  upsertTemplate,
  saveContacts,
  removeContacts,
} from "@/lib/services/whatsapp-db";

export function realInboundDeps(): InboundDeps {
  // one company read per batch, however many messages it carries
  const companies = new Map<string, Promise<Company | null>>();
  const companyOf = (id: string): Promise<Company | null> => {
    let pending = companies.get(id);
    if (!pending) {
      pending = companyById(id);
      companies.set(id, pending);
    }
    return pending;
  };
  return {
    now: () => new Date().toISOString(),
    accountByPhoneId,
    accountByWabaId,
    patchAccount,
    knownMessageIds,
    insertMessage,
    linkMessage,
    updateStatus,
    lastInbound,
    findCustomers,
    setCustomerFields,
    insertLead,
    attachOrphans,
    storeMedia,
    async sendServiceText(account, to, text) {
      const company = await companyOf(account.companyId);
      if (!company) return { ok: false, error: `company ${account.companyId} not found` };
      // the reply answers a message that just arrived, so the window is open by definition
      const answer = await sendText(company, { to, text, lastInAt: new Date().toISOString(), origin: "automation" });
      return answer.ok ? { ok: true } : { ok: false, error: answer.error };
    },
    upsertTemplate,
    saveContacts,
    removeContacts,
    log: {
      info: (message) => console.info(message),
      warn: (message) => console.warn(`[whatsapp] ${message}`),
      error: (message) => console.error(`[whatsapp] ${message}`),
    },
  };
}
