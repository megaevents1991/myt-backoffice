/**
 * The WhatsApp thread as the case and customer pages read it (spec 2026-10-21 section 8): the customer's messages
 * over every phone key of theirs plus the card's own phone, the newest page, the consent and the 24-hour window from
 * the customers row, and whether the company has a connected number. `threadOf` never throws past itself - a read
 * that fails (a table not migrated yet, a DB hiccup) answers the empty thread and logs, so the card still opens.
 * Server only.
 */
import type { Company } from "@/lib/company";
import { WA_THREAD_PAGE } from "@/lib/whatsapp/rules";
import { assembleThread, emptyWaThread, threadKeys, type WaThread, type WaThreadMessage } from "@/lib/tours/cases";
import { accountOfCompany, customerWa, listThread } from "@/lib/services/whatsapp-db";

export async function threadOf(company: Company, customerId: string | null, phones: readonly string[]): Promise<WaThread> {
  try {
    const [customer, account] = await Promise.all([customerId ? customerWa(company.id, customerId) : Promise.resolve(null), accountOfCompany(company.id)]);
    const page = await listThread(company.id, threadKeys(customer?.phoneKeys, phones), { limit: WA_THREAD_PAGE });
    return assembleThread({
      newestFirst: page.messages,
      hasMore: page.hasMore,
      consent: customer ? { state: customer.waConsent, source: customer.waConsentSource, at: customer.waConsentAt } : null,
      lastInAt: customer?.waLastInAt ?? null,
      connected: account !== null,
      now: new Date().toISOString(),
    });
  } catch (e) {
    console.error("whatsapp-thread: thread read failed:", e instanceof Error ? e.message : e);
    return emptyWaThread();
  }
}

/** The page before `before` (an ISO instant), oldest first; throws on a failed read - the caller is an action. */
export async function olderThread(company: Company, customerId: string, before: string): Promise<{ messages: WaThreadMessage[]; hasMore: boolean }> {
  const customer = await customerWa(company.id, customerId);
  if (!customer) return { messages: [], hasMore: false };
  const page = await listThread(company.id, threadKeys(customer.phoneKeys, []), { before, limit: WA_THREAD_PAGE });
  return { messages: [...page.messages].reverse(), hasMore: page.hasMore };
}
