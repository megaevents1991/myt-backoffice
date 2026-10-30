/**
 * The ONE boundary on the WhatsApp tables - wa_accounts, wa_messages, wa_templates (migration
 * 20261021172647) - and on the customers / leads columns the webhook touches. types/database.types.ts cannot
 * be regenerated locally, so the three new tables go through one `as any` cast HERE and everything else in the
 * WhatsApp code receives the typed shapes below. A table that is not there yet (a deploy that beat its
 * migration: 42P01 / PGRST205) reads as the empty value with ONE warning per process; any other error throws.
 * Server only.
 */
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import type { Company } from "@/lib/company";
import type { WaThreadMessage } from "@/lib/tours/cases";
import type { WaMessageType } from "@/lib/whatsapp/rules";
import { isInlineMedia } from "@/lib/whatsapp/meta-provider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const MEDIA_BUCKET = "wa-media";
const SIGNED_URL_SECONDS = 600;
const IN_CHUNK = 100;
/** Meta ids (wamid..., ~60 chars) per .in() request - the list travels in the URL. */
const ID_CHUNK = 100;
/** Rows per page of a count read - a plain select answers 1,000 at most and says nothing. */
const ROW_PAGE = 1000;

type DbError = { code?: string; message?: string } | null | undefined;
const missingTable = (error: DbError): boolean => error?.code === "42P01" || error?.code === "PGRST205";
const missingColumn = (error: DbError): boolean => error?.code === "42703" || error?.code === "PGRST204";
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`whatsapp-db: ${message}`);
}

// ---------------------------------------------------------------- shapes

export interface WaAccount {
  id: string;
  companyId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  verifiedName: string | null;
  mode: "coexistence" | "api_only";
  provider: string;
  qualityRating: string | null;
  messagingLimit: string | null;
  historyRequestedAt: string | null;
  historySyncedAt: string | null;
  contactsRequestedAt: string | null;
  contactsSyncedAt: string | null;
  connectedAt: string;
  isActive: boolean;
}

export type WaMediaStored = { id: string; mime: string; sha256: string | null; caption: string | null; storage_path: string | null };

export interface WaMessageInsert {
  companyId: string;
  waMessageId: string;
  /** The customer's number, international digits. */
  phone: string;
  phoneKey: string;
  customerId: string | null;
  caseId: string | null;
  direction: "in" | "out";
  /** customer | app | api | automation | broadcast | history */
  origin: string;
  type: WaMessageType;
  text: string | null;
  media: WaMediaStored | null;
  template: { name: string; language: string; params: string[] } | null;
  status: string;
  sentBy: string | null;
  sentAt: string;
}

export interface WaCustomerLite {
  id: string;
  customerNo: number;
  phoneKey: string;
  /** The phones as typed - a sender binds only when one of them normalises to the sender's full number. */
  phones: string[];
  waConsent: string;
  waProfileName: string | null;
  waLastInAt: string | null;
}

export interface WaCustomerPatch {
  waLastInAt?: string;
  waProfileName?: string;
  waConsent?: string;
  waConsentSource?: string;
  waConsentAt?: string;
}

export interface WaLeadInsert {
  companyId: string;
  kind: "whatsapp";
  source: "whatsapp";
  name: string | null;
  phone: string;
  phoneKey: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface WaLeadResult {
  id: string;
  caseNo: number | null;
  /** The card the row joined (payload.joined_into.id), or null when it opened a new case. */
  joinedIntoId: string | null;
  customerId: string | null;
}

export interface WaTemplate {
  name: string;
  language: string;
  category: string | null;
  status: string;
  body: string | null;
  paramCount: number | null;
  syncedAt: string;
}

// ---------------------------------------------------------------- accounts

type AccountRow = {
  id: string;
  company_id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone: string;
  verified_name: string | null;
  mode: string;
  provider: string;
  quality_rating: string | null;
  messaging_limit: string | null;
  history_requested_at: string | null;
  history_synced_at: string | null;
  contacts_requested_at: string | null;
  contacts_synced_at: string | null;
  connected_at: string;
  is_active: boolean;
};
const ACCOUNT_COLUMNS =
  "id, company_id, waba_id, phone_number_id, display_phone, verified_name, mode, provider, quality_rating, messaging_limit, history_requested_at, history_synced_at, contacts_requested_at, contacts_synced_at, connected_at, is_active";
const toAccount = (r: AccountRow): WaAccount => ({
  id: r.id,
  companyId: r.company_id,
  wabaId: r.waba_id,
  phoneNumberId: r.phone_number_id,
  displayPhone: r.display_phone,
  verifiedName: r.verified_name,
  mode: r.mode === "api_only" ? "api_only" : "coexistence",
  provider: r.provider,
  qualityRating: r.quality_rating,
  messagingLimit: r.messaging_limit,
  historyRequestedAt: r.history_requested_at,
  historySyncedAt: r.history_synced_at,
  contactsRequestedAt: r.contacts_requested_at,
  contactsSyncedAt: r.contacts_synced_at,
  connectedAt: r.connected_at,
  isActive: r.is_active,
});

async function oneAccount(column: string, value: string): Promise<WaAccount | null> {
  const { data, error } = await db.from("wa_accounts").select(ACCOUNT_COLUMNS).eq(column, value).eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (missingTable(error)) {
      warnOnce("wa_accounts", "wa_accounts is missing (migration not applied) - no number is connected");
      return null;
    }
    throw new Error(`wa_accounts: ${error.message}`);
  }
  return data ? toAccount(data as AccountRow) : null;
}

export const accountByPhoneId = (phoneNumberId: string): Promise<WaAccount | null> => oneAccount("phone_number_id", phoneNumberId);
export const accountByWabaId = (wabaId: string): Promise<WaAccount | null> => oneAccount("waba_id", wabaId);
export const accountOfCompany = (companyId: string): Promise<WaAccount | null> => oneAccount("company_id", companyId);

/** The company holding that phone-number id, active or not - a signup must not take another company's number over (security review). */
export async function phoneOwner(phoneNumberId: string): Promise<string | null> {
  const { data, error } = await db.from("wa_accounts").select("company_id").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(`wa_accounts: ${error.message}`);
  }
  return (data as { company_id: string } | null)?.company_id ?? null;
}

export async function upsertAccount(input: Omit<WaAccount, "id" | "connectedAt">): Promise<WaAccount> {
  const { data, error } = await db
    .from("wa_accounts")
    .upsert(
      {
        company_id: input.companyId,
        waba_id: input.wabaId,
        phone_number_id: input.phoneNumberId,
        display_phone: input.displayPhone,
        verified_name: input.verifiedName,
        mode: input.mode,
        provider: input.provider,
        quality_rating: input.qualityRating,
        messaging_limit: input.messagingLimit,
        history_requested_at: input.historyRequestedAt,
        history_synced_at: input.historySyncedAt,
        contacts_requested_at: input.contactsRequestedAt,
        contacts_synced_at: input.contactsSyncedAt,
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id" },
    )
    .select(ACCOUNT_COLUMNS)
    .single();
  if (error) throw new Error(`wa_accounts: ${error.message}`);
  return toAccount(data as AccountRow);
}

export async function patchAccount(
  id: string,
  patch: Partial<Pick<WaAccount, "qualityRating" | "messagingLimit" | "historyRequestedAt" | "historySyncedAt" | "contactsRequestedAt" | "contactsSyncedAt" | "isActive">>,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.qualityRating !== undefined) row.quality_rating = patch.qualityRating;
  if (patch.messagingLimit !== undefined) row.messaging_limit = patch.messagingLimit;
  if (patch.historyRequestedAt !== undefined) row.history_requested_at = patch.historyRequestedAt;
  if (patch.historySyncedAt !== undefined) row.history_synced_at = patch.historySyncedAt;
  if (patch.contactsRequestedAt !== undefined) row.contacts_requested_at = patch.contactsRequestedAt;
  if (patch.contactsSyncedAt !== undefined) row.contacts_synced_at = patch.contactsSyncedAt;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  const { error } = await db.from("wa_accounts").update(row).eq("id", id);
  if (error) throw new Error(`wa_accounts: ${error.message}`);
}

// ---------------------------------------------------------------- the number's phone book

export type WaContactRow = { phone: string; phoneKey: string; fullName: string | null; firstName: string | null; contactAt: string | null };
/** Rows per upsert: a phone book can run to thousands. */
const CONTACT_CHUNK = 500;
const CONTACT_NAME_MAX = 200;

/** Stored as they stand on the phone, nothing else follows from it: no customer and no card comes of a contact. */
export async function saveContacts(companyId: string, rows: readonly WaContactRow[]): Promise<void> {
  const syncedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += CONTACT_CHUNK) {
    const part = rows.slice(i, i + CONTACT_CHUNK).map((r) => ({
      company_id: companyId,
      phone: r.phone,
      phone_key: r.phoneKey,
      full_name: r.fullName?.slice(0, CONTACT_NAME_MAX) ?? null,
      first_name: r.firstName?.slice(0, CONTACT_NAME_MAX) ?? null,
      contact_at: r.contactAt,
      synced_at: syncedAt,
    }));
    const { error } = await db.from("wa_contacts").upsert(part, { onConflict: "company_id,phone" });
    if (error) {
      if (missingTable(error)) {
        warnOnce("wa_contacts", "wa_contacts is missing (migration not applied) - contacts not stored");
        return;
      }
      throw new Error(`wa_contacts: ${error.message}`);
    }
  }
}

/** A contact the business removed from the phone leaves here too: it is their phone book, not our record. */
export async function removeContacts(companyId: string, phones: readonly string[]): Promise<void> {
  for (let i = 0; i < phones.length; i += IN_CHUNK) {
    const { error } = await db.from("wa_contacts").delete().eq("company_id", companyId).in("phone", phones.slice(i, i + IN_CHUNK));
    if (error) {
      if (missingTable(error)) return;
      throw new Error(`wa_contacts: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------- messages

type MessageRow = {
  id: string;
  wa_message_id: string;
  direction: "in" | "out";
  origin: string;
  type: string;
  text: string | null;
  media: WaMediaStored | null;
  template: { name: string; language?: string; params?: string[] } | null;
  status: string;
  error: string | null;
  sent_at: string;
  sent_by: string | null;
  case_id: string | null;
  customer_id: string | null;
  phone_key: string;
};
const MESSAGE_COLUMNS = "id, wa_message_id, direction, origin, type, text, media, template, status, error, sent_at, sent_by, case_id, customer_id, phone_key";

/** Inserts one message; a wa_message_id already stored (Meta re-delivered the batch) answers inserted: false. */
export async function insertMessage(row: WaMessageInsert): Promise<{ inserted: boolean; id: string | null }> {
  const { data, error } = await db
    .from("wa_messages")
    .upsert(
      {
        company_id: row.companyId,
        wa_message_id: row.waMessageId,
        phone: row.phone,
        phone_key: row.phoneKey,
        customer_id: row.customerId,
        case_id: row.caseId,
        direction: row.direction,
        origin: row.origin,
        type: row.type,
        text: row.text,
        media: row.media,
        template: row.template,
        status: row.status,
        sent_by: row.sentBy,
        sent_at: row.sentAt,
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    if (missingTable(error)) {
      warnOnce("wa_messages", "wa_messages is missing (migration not applied) - messages are not stored");
      return { inserted: false, id: null };
    }
    throw new Error(`wa_messages: ${error.message}`);
  }
  const id = (data as { id: string }[] | null)?.[0]?.id ?? null;
  return { inserted: id !== null, id };
}

export async function linkMessage(id: string, caseId: string | null, customerId: string | null): Promise<void> {
  const { error } = await db.from("wa_messages").update({ case_id: caseId, customer_id: customerId }).eq("id", id);
  if (error) throw new Error(`wa_messages: ${error.message}`);
}

/** A delivery status from Meta; false when no row carries that id (a message sent before the table existed). */
export async function updateStatus(waMessageId: string, status: string, at: string, error: string | null): Promise<boolean> {
  const { data, error: err } = await db.from("wa_messages").update({ status, status_at: at, error }).eq("wa_message_id", waMessageId).select("id");
  if (err) {
    if (missingTable(err)) return false;
    throw new Error(`wa_messages: ${err.message}`);
  }
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** The outcome of OUR send, by row id: Meta's message id once it answered, the status, the error (null when sent). */
export async function finishSend(id: string, patch: { waMessageId?: string; status: string; error: string | null; at: string }): Promise<void> {
  const row: Record<string, unknown> = { status: patch.status, status_at: patch.at, error: patch.error };
  if (patch.waMessageId) row.wa_message_id = patch.waMessageId;
  const { error } = await db.from("wa_messages").update(row).eq("id", id);
  if (error) {
    if (missingTable(error)) return;
    throw new Error(`wa_messages: ${error.message}`);
  }
}

/** Which of these Meta ids are stored already (the webhook reads it once per batch); a missing table knows none. */
export async function knownMessageIds(waMessageIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(waMessageIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await db.from("wa_messages").select("wa_message_id").in("wa_message_id", ids.slice(i, i + ID_CHUNK));
    if (error) {
      if (missingTable(error)) return out;
      throw new Error(`wa_messages: ${error.message}`);
    }
    for (const r of (data ?? []) as { wa_message_id: string }[]) out.add(r.wa_message_id);
  }
  return out;
}

/** A card merged into another (merge_lead_cases moves bookings, seats and notes - not these rows): its messages follow. */
export async function relinkCaseMessages(fromCaseId: string, toCaseId: string): Promise<number> {
  const { data, error } = await db.from("wa_messages").update({ case_id: toCaseId }).eq("case_id", fromCaseId).select("id");
  if (error) {
    if (missingTable(error)) return 0;
    throw new Error(`wa_messages: ${error.message}`);
  }
  return (data as unknown[] | null)?.length ?? 0;
}

/** A customer merged into another: the messages of the merged-away one follow. */
export async function relinkCustomerMessages(fromCustomerId: string, toCustomerId: string): Promise<number> {
  const { data, error } = await db.from("wa_messages").update({ customer_id: toCustomerId }).eq("customer_id", fromCustomerId).select("id");
  if (error) {
    if (missingTable(error)) return 0;
    throw new Error(`wa_messages: ${error.message}`);
  }
  return (data as unknown[] | null)?.length ?? 0;
}

/** A card moved to another customer: the messages on that card follow. */
export async function relinkCardCustomer(caseId: string, customerId: string): Promise<number> {
  const { data, error } = await db.from("wa_messages").update({ customer_id: customerId }).eq("case_id", caseId).select("id");
  if (error) {
    if (missingTable(error)) return 0;
    throw new Error(`wa_messages: ${error.message}`);
  }
  return (data as unknown[] | null)?.length ?? 0;
}

/** The customer's newest LIVE inbound message (origin customer): the 24-hour window and the case the conversation is on. */
export async function lastInbound(companyId: string, phoneKey: string): Promise<{ at: string; caseId: string | null } | null> {
  const { data, error } = await db
    .from("wa_messages")
    .select("sent_at, case_id")
    .eq("company_id", companyId)
    .eq("phone_key", phoneKey)
    .eq("direction", "in")
    // a history row is not a conversation that is on: the gap and the case come from the live ones
    .eq("origin", "customer")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(`wa_messages: ${error.message}`);
  }
  const row = data as { sent_at: string; case_id: string | null } | null;
  return row ? { at: row.sent_at, caseId: row.case_id } : null;
}

/** Messages of that FULL number stored before the customer existed get the customer now. */
export async function attachOrphans(companyId: string, phone: string, customerId: string): Promise<number> {
  const { data, error } = await db.from("wa_messages").update({ customer_id: customerId }).eq("company_id", companyId).eq("phone", phone).is("customer_id", null).select("id");
  if (error) {
    if (missingTable(error)) return 0;
    throw new Error(`wa_messages: ${error.message}`);
  }
  return (data as unknown[] | null)?.length ?? 0;
}

/** A picture renders inline; any other file is served as a download (Content-Disposition: attachment), never as a page. */
async function signedUrl(path: string, mime: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS, isInlineMedia(mime) ? undefined : { download: true });
  if (error) {
    console.warn(`whatsapp-db: signed url failed for ${path}: ${error.message}`);
    return null;
  }
  return data?.signedUrl ?? null;
}

async function toThreadMessage(r: MessageRow): Promise<WaThreadMessage> {
  const path = r.media?.storage_path ?? null;
  return {
    id: r.id,
    waMessageId: r.wa_message_id,
    direction: r.direction,
    origin: r.origin,
    type: r.type as WaMessageType,
    text: r.text,
    mediaUrl: path ? await signedUrl(path, r.media?.mime ?? "") : null,
    mediaMime: r.media?.mime ?? null,
    template: r.template ? { name: r.template.name, params: r.template.params ?? [] } : null,
    status: r.status,
    error: r.error,
    sentAt: r.sent_at,
    sentBy: r.sent_by,
    caseId: r.case_id,
  };
}

/** The thread over every phone of the customer, newest FIRST (the card reverses it); `limit + 1` read to answer hasMore. */
export async function listThread(
  companyId: string,
  phoneKeys: string[],
  opts: { before?: string; limit: number },
): Promise<{ messages: WaThreadMessage[]; hasMore: boolean }> {
  const keys = [...new Set(phoneKeys.filter(Boolean))];
  if (keys.length === 0) return { messages: [], hasMore: false };
  let query = db.from("wa_messages").select(MESSAGE_COLUMNS).eq("company_id", companyId).in("phone_key", keys).order("sent_at", { ascending: false }).limit(opts.limit + 1);
  if (opts.before) query = query.lt("sent_at", opts.before);
  const { data, error } = await query;
  if (error) {
    if (missingTable(error)) {
      warnOnce("wa_messages", "wa_messages is missing (migration not applied) - the thread is empty");
      return { messages: [], hasMore: false };
    }
    throw new Error(`wa_messages: ${error.message}`);
  }
  const rows = (data ?? []) as MessageRow[];
  const page = rows.slice(0, opts.limit);
  return { messages: await Promise.all(page.map(toThreadMessage)), hasMore: rows.length > opts.limit };
}

/**
 * Inbound messages after each card's wa_seen_at (all of them when never opened), by case id. Read in pages (a plain
 * select answers 1,000 rows at most and says nothing - the 05.10 rule) and, when every card of the chunk has a stamp,
 * floored at the oldest one, so an old thread is not re-read on every board load.
 */
export async function countUnseen(cases: { id: string; waSeenAt: string | null }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (cases.length === 0) return out;
  const seen = new Map(cases.map((c) => [c.id, c.waSeenAt]));
  for (let i = 0; i < cases.length; i += IN_CHUNK) {
    const part = cases.slice(i, i + IN_CHUNK);
    const ids = part.map((c) => c.id);
    const stamps = part.map((c) => c.waSeenAt).filter((v): v is string => !!v);
    const floor = stamps.length === part.length ? [...stamps].sort()[0] : null;
    for (let from = 0; ; from += ROW_PAGE) {
      let query = db
        .from("wa_messages")
        .select("case_id, sent_at")
        .in("case_id", ids)
        .eq("direction", "in")
        .order("sent_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + ROW_PAGE - 1);
      if (floor) query = query.gt("sent_at", floor);
      const { data, error } = await query;
      if (error) {
        if (missingTable(error)) return out;
        throw new Error(`wa_messages: ${error.message}`);
      }
      const rows = (data ?? []) as { case_id: string; sent_at: string }[];
      for (const row of rows) {
        const at = seen.get(row.case_id);
        if (at === undefined) continue;
        if (at === null || row.sent_at > at) out.set(row.case_id, (out.get(row.case_id) ?? 0) + 1);
      }
      if (rows.length < ROW_PAGE) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- customers + leads (the typed tables)

const CUSTOMER_COLUMNS = "id, customer_no, phones, phone_keys, wa_consent, wa_profile_name, wa_last_in_at";

/** Every live customer of the company holding that phone key, lowest customer_no first (the one leads_fill picks). */
export async function findCustomers(companyId: string, phoneKey: string): Promise<WaCustomerLite[]> {
  if (!phoneKey) return [];
  const read = (columns: string) =>
    supabaseTyped.from("customers").select(columns).eq("company_id", companyId).is("is_deleted", null).contains("phone_keys", [phoneKey]).order("customer_no", { ascending: true });
  let answer = await read(CUSTOMER_COLUMNS);
  if (answer.error && missingColumn(answer.error)) {
    warnOnce("customers.wa", "customers.wa_* columns are missing (migration not applied)");
    answer = await read("id, customer_no, phones, phone_keys");
  }
  if (answer.error) throw new Error(`customers: ${answer.error.message}`);
  return ((answer.data ?? []) as unknown as { id: string; customer_no: number; phones?: string[] | null; wa_consent?: string; wa_profile_name?: string | null; wa_last_in_at?: string | null }[]).map((r) => ({
    id: r.id,
    customerNo: r.customer_no,
    phoneKey,
    phones: r.phones ?? [],
    waConsent: r.wa_consent ?? "none",
    waProfileName: r.wa_profile_name ?? null,
    waLastInAt: r.wa_last_in_at ?? null,
  }));
}

export interface WaCustomerConsent {
  phoneKeys: string[];
  waConsent: string;
  waConsentSource: string | null;
  waConsentAt: string | null;
  waLastInAt: string | null;
}

/** The customer's keys and consent, scoped to the company; null when not theirs. Missing wa_* columns read as "none". */
export async function customerWa(companyId: string, customerId: string): Promise<WaCustomerConsent | null> {
  const read = (columns: string) => supabaseTyped.from("customers").select(columns).eq("company_id", companyId).eq("id", customerId).is("is_deleted", null).maybeSingle();
  let answer = await read("id, phone_keys, wa_consent, wa_consent_source, wa_consent_at, wa_last_in_at");
  if (answer.error && missingColumn(answer.error)) {
    warnOnce("customers.wa", "customers.wa_* columns are missing (migration not applied)");
    answer = await read("id, phone_keys");
  }
  if (answer.error) throw new Error(`customers: ${answer.error.message}`);
  const r = answer.data as unknown as { phone_keys?: string[] | null; wa_consent?: string; wa_consent_source?: string | null; wa_consent_at?: string | null; wa_last_in_at?: string | null } | null;
  if (!r) return null;
  return { phoneKeys: r.phone_keys ?? [], waConsent: r.wa_consent ?? "none", waConsentSource: r.wa_consent_source ?? null, waConsentAt: r.wa_consent_at ?? null, waLastInAt: r.wa_last_in_at ?? null };
}

export async function setCustomerFields(customerId: string, patch: WaCustomerPatch): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.waLastInAt !== undefined) row.wa_last_in_at = patch.waLastInAt;
  if (patch.waProfileName !== undefined) row.wa_profile_name = patch.waProfileName;
  if (patch.waConsent !== undefined) row.wa_consent = patch.waConsent;
  if (patch.waConsentSource !== undefined) row.wa_consent_source = patch.waConsentSource;
  if (patch.waConsentAt !== undefined) row.wa_consent_at = patch.waConsentAt;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabaseTyped.from("customers").update(row).eq("id", customerId);
  if (error) {
    if (missingColumn(error)) {
      warnOnce("customers.wa", "customers.wa_* columns are missing (migration not applied)");
      return;
    }
    throw new Error(`customers: ${error.message}`);
  }
}

/** A `whatsapp` inquiry row; leads_fill routes it (joins the customer's newest open card or opens a case). */
export async function insertLead(row: WaLeadInsert): Promise<WaLeadResult> {
  const { data, error } = await supabaseTyped
    .from("leads")
    .insert({
      company_id: row.companyId,
      kind: row.kind,
      source: row.source,
      name: row.name ?? "",
      phone: row.phone,
      email: "",
      message: row.message,
      payload: row.payload as never,
    })
    .select("id, case_no, payload, customer_id")
    .single();
  if (error) throw new Error(`leads: ${error.message}`);
  const payload = (data.payload ?? {}) as { joined_into?: { id?: string } };
  return { id: data.id, caseNo: data.case_no ?? null, joinedIntoId: payload.joined_into?.id ?? null, customerId: data.customer_id ?? null };
}

// ---------------------------------------------------------------- templates

type TemplateRow = { name: string; language: string; category: string | null; status: string; body: string | null; param_count: number | null; synced_at: string };
const toTemplate = (r: TemplateRow): WaTemplate => ({ name: r.name, language: r.language, category: r.category, status: r.status, body: r.body, paramCount: r.param_count, syncedAt: r.synced_at });

export async function upsertTemplate(companyId: string, t: Omit<WaTemplate, "syncedAt">): Promise<void> {
  const { error } = await db
    .from("wa_templates")
    .upsert(
      { company_id: companyId, name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, param_count: t.paramCount, synced_at: new Date().toISOString() },
      { onConflict: "company_id,name,language" },
    );
  if (error) {
    if (missingTable(error)) {
      warnOnce("wa_templates", "wa_templates is missing (migration not applied)");
      return;
    }
    throw new Error(`wa_templates: ${error.message}`);
  }
}

export async function listTemplates(companyId: string): Promise<WaTemplate[]> {
  const { data, error } = await db.from("wa_templates").select("name, language, category, status, body, param_count, synced_at").eq("company_id", companyId).order("name");
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(`wa_templates: ${error.message}`);
  }
  return ((data ?? []) as TemplateRow[]).map(toTemplate);
}

// ---------------------------------------------------------------- the company behind an account

export async function companyById(id: string): Promise<Company | null> {
  const { data, error } = await supabaseTyped.from("companies").select("id, slug, name, product_types, default_currency, site_url").eq("id", id).maybeSingle();
  if (error) throw new Error(`companies: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    productTypes: (data.product_types ?? []).filter((p): p is "events" | "tours" => p === "events" || p === "tours"),
    defaultCurrency: data.default_currency,
    siteUrl: data.site_url,
  };
}
