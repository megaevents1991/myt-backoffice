/**
 * What the webhook does with Meta's events (spec 2026-10-21 section 6). Every dependency is injected
 * (`InboundDeps`) so the whole flow runs in scripts/whatsapp-inbound-selftest.ts over stubs; the real wiring
 * is `lib/services/whatsapp-inbound-deps.ts` (the DB boundary + the sender).
 *
 * Per batch: the ids already stored are read ONCE (a re-delivered batch then costs no further read) and a phone's
 * customers are looked up once. Per inbound customer message: store it, stamp the customer's window, an opt-out
 * word closes marketing and gets ONE free reply, otherwise a message after WA_INQUIRY_GAP_HOURS of silence - or one
 * whose conversation never got its case (the lead insert failed last time) - inserts a `whatsapp` lead that
 * leads_fill routes (joins the customer's newest open card or opens a case); messages inside the gap hang on the
 * same case. An echo (a rep wrote from the app) is stored on the conversation's case; history rows are stored and
 * never open anything, and each history chunk stamps the account's history_synced_at. Nothing here throws past the
 * function: a failed event lands in `errors`, the rest of the batch goes on.
 */
import { OPT_OUT_REPLY, isOptOut, shouldOpenInquiry, standInText, type WaEvent } from "@/lib/whatsapp/rules";
import { phoneKey, whatsappPhone } from "@/lib/tours/cases";
import type { WaAccount, WaContactRow, WaCustomerLite, WaCustomerPatch, WaLeadInsert, WaLeadResult, WaMessageInsert, WaTemplate } from "@/lib/services/whatsapp-db";

export interface InboundDeps {
  now(): string;
  accountByPhoneId(phoneNumberId: string): Promise<WaAccount | null>;
  accountByWabaId(wabaId: string): Promise<WaAccount | null>;
  patchAccount(id: string, patch: { qualityRating?: string | null; messagingLimit?: string | null; historySyncedAt?: string; contactsSyncedAt?: string }): Promise<void>;
  /** Which of these Meta ids are stored already - read once per batch, so a re-delivered batch costs no further read. */
  knownMessageIds(waMessageIds: string[]): Promise<Set<string>>;
  insertMessage(row: WaMessageInsert): Promise<{ inserted: boolean; id: string | null }>;
  linkMessage(id: string, caseId: string | null, customerId: string | null): Promise<void>;
  updateStatus(waMessageId: string, status: string, at: string, error: string | null): Promise<boolean>;
  /** The customer's newest LIVE inbound message (origin customer): the 24-hour gap and the conversation's case - a history row is neither. */
  lastInbound(companyId: string, phoneKey: string): Promise<{ at: string; caseId: string | null } | null>;
  findCustomers(companyId: string, phoneKey: string): Promise<WaCustomerLite[]>;
  setCustomerFields(customerId: string, patch: WaCustomerPatch): Promise<void>;
  insertLead(row: WaLeadInsert): Promise<WaLeadResult>;
  /** Messages of that FULL international number stored with no customer get one. */
  attachOrphans(companyId: string, phone: string, customerId: string): Promise<number>;
  /** Downloads Meta's media into the private bucket; the storage path, or null when it could not be fetched. */
  storeMedia(account: WaAccount, mediaId: string, mime: string): Promise<string | null>;
  /** A free-text service message inside the window (the opt-out confirmation). */
  sendServiceText(account: WaAccount, to: string, text: string): Promise<{ ok: boolean; error?: string }>;
  upsertTemplate(companyId: string, t: Omit<WaTemplate, "syncedAt">): Promise<void>;
  saveContacts(companyId: string, rows: readonly WaContactRow[]): Promise<void>;
  removeContacts(companyId: string, phones: readonly string[]): Promise<void>;
  log: { warn(message: string): void; error(message: string): void; info?(message: string): void };
}

export interface InboundSummary {
  stored: number;
  skipped: number;
  inquiries: number;
  optOuts: number;
  statuses: number;
  contacts: number;
  errors: string[];
}

/** What one batch shares: the ids already stored, and one customer lookup per phone. */
type Batch = { known: Set<string>; customers: Map<string, Promise<WaCustomerLite[]>> };

function customersOf(deps: InboundDeps, batch: Batch, companyId: string, key: string): Promise<WaCustomerLite[]> {
  const cacheKey = `${companyId}|${key}`;
  let pending = batch.customers.get(cacheKey);
  if (!pending) {
    pending = deps.findCustomers(companyId, key);
    batch.customers.set(cacheKey, pending);
  }
  return pending;
}

/**
 * The customer a sender binds to: among the live rows holding the key, only those with a stored phone that
 * normalises to the sender's FULL international number (a last-9-digits key alone could collide across country
 * codes - security review 21.10), the lowest customer number first (the one leads_fill picks).
 */
export function pickCustomer(candidates: readonly WaCustomerLite[], from: string): WaCustomerLite | null {
  const same = candidates.filter((c) => c.phones.some((p) => whatsappPhone(p) === from));
  if (same.length === 0) return null;
  return [...same].sort((a, b) => a.customerNo - b.customerNo)[0];
}

type MessageEvent = Extract<WaEvent, { kind: "message" }>;

async function handleMessage(ev: MessageEvent, deps: InboundDeps, out: InboundSummary, batch: Batch): Promise<void> {
  // a re-delivered id costs nothing: no account read, no customer read, no media download
  if (batch.known.has(ev.waMessageId)) {
    out.skipped += 1;
    return;
  }
  const account = await deps.accountByPhoneId(ev.phoneNumberId);
  if (!account) {
    deps.log.warn(`message ${ev.waMessageId} for an unknown phone number id ${ev.phoneNumberId} - skipped`);
    out.skipped += 1;
    return;
  }
  // the CUSTOMER's number keys the thread: the sender of an inbound message, the recipient of an outbound one
  const phone = ev.direction === "in" ? ev.from : ev.to;
  if (!phone) {
    deps.log.warn(`message ${ev.waMessageId} names no customer number - skipped`);
    out.skipped += 1;
    return;
  }
  const key = phoneKey(phone);
  if (!key) {
    deps.log.warn(`message ${ev.waMessageId} from a number with no key (${phone}) - skipped`);
    out.skipped += 1;
    return;
  }
  const companyId = account.companyId;
  const live = ev.origin !== "history";
  const inboundFromCustomer = ev.direction === "in" && ev.origin === "customer";

  const customer = pickCustomer(await customersOf(deps, batch, companyId, key), phone);
  // read BEFORE this message is stored: the gap is measured against the previous LIVE inbound one; history opens nothing
  const previous = live ? await deps.lastInbound(companyId, key) : null;
  const media = ev.media
    ? { ...ev.media, storage_path: live && ev.media.id ? await deps.storeMedia(account, ev.media.id, ev.media.mime) : null }
    : null;

  const stored = await deps.insertMessage({
    companyId,
    waMessageId: ev.waMessageId,
    phone,
    phoneKey: key,
    customerId: customer?.id ?? null,
    caseId: previous?.caseId ?? null,
    direction: ev.direction,
    origin: ev.origin,
    type: ev.type,
    text: ev.text,
    media,
    template: null,
    status: ev.direction === "in" ? "received" : "sent",
    sentBy: null,
    sentAt: ev.sentAt,
  });
  if (!stored.inserted || !stored.id) {
    out.skipped += 1;
    return;
  }
  out.stored += 1;
  if (!inboundFromCustomer) return;

  if (customer) {
    const patch: WaCustomerPatch = { waLastInAt: ev.sentAt };
    if (!customer.waProfileName && ev.profileName) patch.waProfileName = ev.profileName;
    await deps.setCustomerFields(customer.id, patch);
  }

  if (isOptOut(ev.text)) {
    if (customer) await deps.setCustomerFields(customer.id, { waConsent: "opted_out", waConsentSource: "reply", waConsentAt: ev.sentAt });
    const answer = await deps.sendServiceText(account, phone, OPT_OUT_REPLY);
    if (!answer.ok) deps.log.warn(`opt-out reply to ${key} not sent: ${answer.error ?? "unknown"}`);
    out.optOuts += 1;
    return;
  }

  // a new conversation (24 h of silence), or one that never got its case (the lead insert failed last time): open it now
  if (!shouldOpenInquiry(previous?.at ?? null, ev.sentAt) && previous?.caseId) return;

  const lead = await deps.insertLead({
    companyId,
    kind: "whatsapp",
    source: "whatsapp",
    name: ev.profileName,
    phone,
    phoneKey: key,
    message: ev.text ?? standInText(ev.type),
    payload: { wa_message_id: ev.waMessageId },
  });
  out.inquiries += 1;
  const caseId = lead.joinedIntoId ?? lead.id;
  const customerId = lead.customerId ?? customer?.id ?? null;
  await deps.linkMessage(stored.id, caseId, customerId);
  if (lead.customerId) {
    // the lead found or created the customer: messages of this full number stored before it get the customer too
    await deps.attachOrphans(companyId, phone, lead.customerId);
    if (!customer) await deps.setCustomerFields(lead.customerId, { waLastInAt: ev.sentAt, ...(ev.profileName ? { waProfileName: ev.profileName } : {}) });
  }
}

/** A chunk of the history sync arrived: the account's history_synced_at says when the last one came. */
async function handleHistory(ev: Extract<WaEvent, { kind: "history" }>, deps: InboundDeps, out: InboundSummary): Promise<void> {
  const account = await deps.accountByPhoneId(ev.phoneNumberId);
  if (!account) {
    out.skipped += 1;
    return;
  }
  await deps.patchAccount(account.id, { historySyncedAt: deps.now() });
}

async function handleTemplate(ev: Extract<WaEvent, { kind: "template" }>, deps: InboundDeps, out: InboundSummary): Promise<void> {
  const account = await deps.accountByWabaId(ev.wabaId);
  if (!account) {
    deps.log.warn(`template update for an unknown WABA ${ev.wabaId} - skipped`);
    out.skipped += 1;
    return;
  }
  await deps.upsertTemplate(account.companyId, { name: ev.name, language: ev.language, category: null, status: ev.status, body: null, paramCount: null });
}

async function handleAccount(ev: Extract<WaEvent, { kind: "account" }>, deps: InboundDeps, out: InboundSummary): Promise<void> {
  const account = await deps.accountByWabaId(ev.wabaId);
  if (!account) {
    out.skipped += 1;
    return;
  }
  const payload = (ev.payload ?? {}) as { current_limit?: unknown; event?: unknown };
  const patch: { qualityRating?: string | null; messagingLimit?: string | null } = {};
  if (typeof payload.current_limit === "string") patch.messagingLimit = payload.current_limit;
  if (ev.field === "phone_number_quality_update" && typeof payload.event === "string") patch.qualityRating = payload.event;
  if (Object.keys(patch).length) await deps.patchAccount(account.id, patch);
}

/**
 * The phone book of a number on the app: one write per batch, because a sync can carry thousands and the webhook has 30
 * seconds. The last word per number wins, written two ways it is one number. It touches no customer and opens no card, and
 * a failure names no contact: this is a private phone book, so it stays out of the logs.
 */
async function handleContacts(events: Extract<WaEvent, { kind: "contact" }>[], deps: InboundDeps, out: InboundSummary): Promise<void> {
  for (const phoneNumberId of new Set(events.map((ev) => ev.phoneNumberId))) {
    const batch = events.filter((ev) => ev.phoneNumberId === phoneNumberId);
    try {
      const account = await deps.accountByPhoneId(phoneNumberId);
      if (!account) {
        out.skipped += batch.length;
        continue;
      }
      const last = new Map<string, Extract<WaEvent, { kind: "contact" }>>();
      for (const ev of batch) {
        const phone = whatsappPhone(ev.phone);
        if (phone) last.set(phone, ev);
        else out.skipped += 1;
      }
      const entries = [...last.entries()];
      const saves: WaContactRow[] = entries
        .filter(([, ev]) => ev.action === "add")
        .map(([phone, ev]) => ({ phone, phoneKey: phoneKey(phone), fullName: ev.fullName, firstName: ev.firstName, contactAt: ev.at }));
      const removes = entries.filter(([, ev]) => ev.action === "remove").map(([phone]) => phone);
      if (saves.length) await deps.saveContacts(account.companyId, saves);
      if (removes.length) await deps.removeContacts(account.companyId, removes);
      out.contacts += saves.length + removes.length;
      await deps.patchAccount(account.id, { contactsSyncedAt: deps.now() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.log.error(`contacts of ${phoneNumberId}: ${message}`);
      out.errors.push(`contact: ${message}`);
    }
  }
}

/** Every event of one webhook batch, each on its own: a failure is counted and named, never thrown. */
export async function handleWebhookEvents(events: WaEvent[], deps: InboundDeps): Promise<InboundSummary> {
  const out: InboundSummary = { stored: 0, skipped: 0, inquiries: 0, optOuts: 0, statuses: 0, contacts: 0, errors: [] };
  const ids = events.flatMap((ev) => (ev.kind === "message" ? [ev.waMessageId] : []));
  let known = new Set<string>();
  if (ids.length > 0) {
    try {
      known = await deps.knownMessageIds(ids);
    } catch (e) {
      // the insert still ignores a duplicate - the batch only pays the reads it could have skipped
      deps.log.warn(`known-id check failed (${e instanceof Error ? e.message : String(e)}) - every message is tried`);
    }
  }
  const batch: Batch = { known, customers: new Map() };
  for (const ev of events) {
    try {
      if (ev.kind === "message") await handleMessage(ev, deps, out, batch);
      else if (ev.kind === "status") {
        await deps.updateStatus(ev.waMessageId, ev.status, ev.at, ev.error);
        out.statuses += 1;
      } else if (ev.kind === "history") await handleHistory(ev, deps, out);
      else if (ev.kind === "template") await handleTemplate(ev, deps, out);
      else if (ev.kind === "account") await handleAccount(ev, deps, out);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.log.error(`${ev.kind} ${"waMessageId" in ev ? ev.waMessageId : ""}: ${message}`);
      out.errors.push(`${ev.kind}: ${message}`);
    }
  }
  const contacts = events.filter((ev): ev is Extract<WaEvent, { kind: "contact" }> => ev.kind === "contact");
  if (contacts.length) await handleContacts(contacts, deps, out);
  return out;
}
