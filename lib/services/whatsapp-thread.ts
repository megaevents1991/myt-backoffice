/**
 * The WhatsApp thread as the case and customer pages read it (spec 2026-10-21 section 8): the customer's messages
 * over every phone key of theirs plus the card's own phone, the newest page, the consent and the 24-hour window from
 * the customers row, and whether the company has a connected number - cut to what the VIEWER may see (a manager
 * everything, a rep the messages on their own / unassigned cards and the unlinked ones; security review 21.10).
 * `threadOf` never throws past itself - a read that fails (a table not migrated yet, a DB hiccup) answers the empty
 * thread and logs, so the card still opens. Server only.
 */
import type { Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { canSeeCard, type BoardViewer } from "@/lib/tours/board";
import { WA_THREAD_PAGE } from "@/lib/whatsapp/rules";
import { assembleThread, emptyWaThread, scopeThread, threadKeys, type ThreadScope, type WaThread, type WaThreadMessage } from "@/lib/tours/cases";
import { accountOfCompany, customerWa, listThread } from "@/lib/services/whatsapp-db";

/** A precomputed scope (the customer page knows its visible cards), or the viewer to compute one for. */
export type ThreadAccess = { scope: ThreadScope } | { viewer: BoardViewer };

/** The cards of the customer this viewer may see; a manager needs no read. */
export async function threadScopeFor(company: Company, customerId: string | null, viewer: BoardViewer): Promise<ThreadScope> {
  if (viewer.manager) return { all: true };
  if (!customerId) return { visibleCaseIds: new Set() };
  const { data, error } = await supabaseTyped.from("leads").select("id, assigned_to").eq("company_id", company.id).eq("customer_id", customerId).is("is_deleted", null);
  if (error) throw new Error(`leads: ${error.message}`);
  return { visibleCaseIds: new Set((data ?? []).filter((r) => canSeeCard({ assignedTo: r.assigned_to ?? null }, viewer)).map((r) => r.id)) };
}

const scopeOf = (company: Company, customerId: string | null, access: ThreadAccess): Promise<ThreadScope> =>
  "scope" in access ? Promise.resolve(access.scope) : threadScopeFor(company, customerId, access.viewer);

export async function threadOf(company: Company, customerId: string | null, phones: readonly string[], access: ThreadAccess): Promise<WaThread> {
  try {
    const [customer, account, scope] = await Promise.all([
      customerId ? customerWa(company.id, customerId) : Promise.resolve(null),
      accountOfCompany(company.id),
      scopeOf(company, customerId, access),
    ]);
    const page = await listThread(company.id, threadKeys(customer?.phoneKeys, phones), { limit: WA_THREAD_PAGE });
    return assembleThread({
      newestFirst: scopeThread(page.messages, scope),
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

/** The page before `before` (an ISO instant), oldest first, cut to the scope; throws on a failed read - the caller is an action. */
export async function olderThread(company: Company, customerId: string, before: string, scope: ThreadScope): Promise<{ messages: WaThreadMessage[]; hasMore: boolean }> {
  const customer = await customerWa(company.id, customerId);
  if (!customer) return { messages: [], hasMore: false };
  const page = await listThread(company.id, threadKeys(customer.phoneKeys, []), { before, limit: WA_THREAD_PAGE });
  return { messages: scopeThread(page.messages, scope).reverse(), hasMore: page.hasMore };
}
