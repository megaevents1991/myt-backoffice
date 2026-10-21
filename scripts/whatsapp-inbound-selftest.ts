// scripts/whatsapp-inbound-selftest.ts - `npx tsx scripts/whatsapp-inbound-selftest.ts`
// The inbound flow (lib/services/whatsapp-inbound.ts) over in-memory stubs of its dependencies: every
// message stored once, ONE inquiry per conversation (24 h gap), the opt-out reply, a rep's echo from the
// app, history rows, statuses, template updates, an unknown number id, a missing table. No DB, no network.
import assert from "node:assert/strict";
import { OPT_OUT_REPLY, type WaEvent } from "../lib/whatsapp/rules";
import { handleWebhookEvents, type InboundDeps } from "../lib/services/whatsapp-inbound";
import { whatsappPhone } from "../lib/tours/cases";
import type { WaAccount, WaCustomerLite, WaCustomerPatch, WaLeadInsert, WaMessageInsert } from "../lib/services/whatsapp-db";

const ACCOUNT: WaAccount = {
  id: "acc-1",
  companyId: "co-1",
  wabaId: "222",
  phoneNumberId: "111",
  displayPhone: "+972 54-227-2554",
  verifiedName: "Mega Family",
  mode: "coexistence",
  provider: "meta",
  qualityRating: null,
  messagingLimit: null,
  historyRequestedAt: null,
  historySyncedAt: null,
  connectedAt: "2026-10-20T00:00:00.000Z",
  isActive: true,
};

type Stored = WaMessageInsert & { id: string };

function makeDeps(opts: { customers?: WaCustomerLite[]; openCardId?: string | null; insertFails?: boolean } = {}) {
  const messages: Stored[] = [];
  const leads: (WaLeadInsert & { id: string; joinedIntoId: string | null; customerId: string | null })[] = [];
  const customerPatches: { id: string; patch: WaCustomerPatch }[] = [];
  const sent: { to: string; text: string }[] = [];
  const attached: { key: string; customerId: string }[] = [];
  const statusUpdates: { id: string; status: string; error: string | null }[] = [];
  const templates: { companyId: string; name: string; status: string }[] = [];
  const linked: { id: string; caseId: string | null; customerId: string | null }[] = [];
  const warnings: string[] = [];
  let seq = 0;
  const deps: InboundDeps = {
    now: () => "2026-10-21T10:00:00.000Z",
    accountByPhoneId: async (id) => (id === "111" ? ACCOUNT : null),
    accountByWabaId: async (id) => (id === "222" ? ACCOUNT : null),
    patchAccount: async () => {},
    insertMessage: async (row) => {
      if (opts.insertFails) {
        warnings.push("wa_messages missing");
        return { inserted: false, id: null };
      }
      if (messages.some((m) => m.waMessageId === row.waMessageId)) return { inserted: false, id: null };
      const id = `m-${++seq}`;
      messages.push({ ...row, id });
      return { inserted: true, id };
    },
    linkMessage: async (id, caseId, customerId) => {
      linked.push({ id, caseId, customerId });
      const m = messages.find((x) => x.id === id);
      if (m) {
        m.caseId = caseId;
        m.customerId = customerId;
      }
    },
    updateStatus: async (id, status, _at, error) => {
      statusUpdates.push({ id, status, error });
      return true;
    },
    knownMessageIds: async (ids) => new Set(ids.filter((id) => messages.some((m) => m.waMessageId === id))),
    // the newest LIVE inbound message (origin customer) - a history row is not a conversation that is on
    lastInbound: async (companyId, key) => {
      const rows = messages.filter((m) => m.companyId === companyId && m.phoneKey === key && m.direction === "in" && m.origin === "customer").sort((a, b) => b.sentAt.localeCompare(a.sentAt));
      return rows[0] ? { at: rows[0].sentAt, caseId: rows[0].caseId } : null;
    },
    findCustomers: async (_companyId, key) => (opts.customers ?? []).filter((c) => c.phoneKey === key),
    setCustomerFields: async (id, patch) => {
      customerPatches.push({ id, patch });
    },
    insertLead: async (row) => {
      const id = `lead-${++seq}`;
      // leads_fill picks the LOWEST customer_no holding the phone key - and for a whatsapp row only a customer whose
      // stored phone normalises to the same full number (migration 20261021172647)
      const existing = (opts.customers ?? [])
        .filter((c) => c.phoneKey === row.phoneKey && c.phones.some((p) => whatsappPhone(p) === whatsappPhone(row.phone)))
        .sort((a, b) => a.customerNo - b.customerNo)[0];
      const customerId = existing?.id ?? `c-new-${seq}`;
      const joinedIntoId = opts.openCardId ?? null;
      leads.push({ ...row, id, joinedIntoId, customerId });
      return { id, caseNo: 1000 + seq, joinedIntoId, customerId };
    },
    attachOrphans: async (_companyId, phone, customerId) => {
      attached.push({ key: phone, customerId });
      return 0;
    },
    storeMedia: async (_account, mediaId) => (mediaId === "broken" ? null : `wa/co-1/${mediaId}.bin`),
    sendServiceText: async (_account, to, text) => {
      sent.push({ to, text });
      return { ok: true };
    },
    upsertTemplate: async (companyId, t) => {
      templates.push({ companyId, name: t.name, status: t.status });
    },
    log: { warn: (m) => warnings.push(m), error: (m) => warnings.push(`error: ${m}`) },
  };
  return { deps, messages, leads, customerPatches, sent, attached, statusUpdates, templates, linked, warnings };
}

const inbound = (id: string, at: string, text: string | null, extra: Partial<Extract<WaEvent, { kind: "message" }>> = {}): WaEvent => ({
  kind: "message",
  phoneNumberId: "111",
  waMessageId: id,
  from: "972541234567",
  to: null,
  profileName: "דנה",
  type: "text",
  text,
  media: null,
  sentAt: at,
  origin: "customer",
  direction: "in",
  ...extra,
});
const echo = (id: string, at: string, text: string, origin: "app" | "history" = "app"): WaEvent => ({
  kind: "message",
  phoneNumberId: "111",
  waMessageId: id,
  from: "972542272554",
  to: "972541234567",
  profileName: null,
  type: "text",
  text,
  media: null,
  sentAt: at,
  origin,
  direction: "out",
});

const DANA: WaCustomerLite = { id: "c-dana", customerNo: 1001, phoneKey: "541234567", phones: ["054-1234567"], waConsent: "none", waProfileName: null, waLastInAt: null };

async function main(): Promise<void> {
// 1. first text from a known customer: stored, ONE inquiry, the message linked to the case the inquiry landed on
{
  const t = makeDeps({ customers: [DANA], openCardId: "card-A" });
  const r = await handleWebhookEvents([inbound("wamid.1", "2026-10-21T09:00:00.000Z", "היי, יש מקום?")], t.deps);
  assert.deepEqual({ stored: r.stored, inquiries: r.inquiries, skipped: r.skipped, errors: r.errors }, { stored: 1, inquiries: 1, skipped: 0, errors: [] });
  assert.equal(t.leads.length, 1);
  assert.equal(t.leads[0].kind, "whatsapp");
  assert.equal(t.leads[0].source, "whatsapp");
  assert.equal(t.leads[0].message, "היי, יש מקום?");
  assert.equal(t.leads[0].name, "דנה");
  assert.equal(t.leads[0].phone, "972541234567");
  assert.deepEqual(t.leads[0].payload, { wa_message_id: "wamid.1" });
  assert.equal(t.messages[0].caseId, "card-A", "linked to the card the inquiry joined");
  assert.equal(t.messages[0].customerId, "c-dana");
  assert.equal(t.messages[0].phoneKey, "541234567");
  assert.equal(t.messages[0].status, "received");
  const last = t.customerPatches.find((p) => p.patch.waLastInAt);
  assert.equal(last?.patch.waLastInAt, "2026-10-21T09:00:00.000Z", "the window is stamped on the customer");
  assert.equal(last?.patch.waProfileName, "דנה", "the profile name fills an empty one");

  // 2. a second text five minutes later: stored, no new inquiry, same case
  const r2 = await handleWebhookEvents([inbound("wamid.2", "2026-10-21T09:05:00.000Z", "הלו?")], t.deps);
  assert.equal(r2.inquiries, 0);
  assert.equal(t.messages[1].caseId, "card-A");

  // 3. a text two days later: a new inquiry (the stub joins card-A again)
  const r3 = await handleWebhookEvents([inbound("wamid.3", "2026-10-23T12:00:00.000Z", "עדיין רלוונטי?")], t.deps);
  assert.equal(r3.inquiries, 1);
  assert.equal(t.leads.length, 2);

  // 4. handles a re-delivered batch once
  const r4 = await handleWebhookEvents([inbound("wamid.3", "2026-10-23T12:00:00.000Z", "עדיין רלוונטי?")], t.deps);
  assert.deepEqual({ stored: r4.stored, skipped: r4.skipped, inquiries: r4.inquiries }, { stored: 0, skipped: 1, inquiries: 0 });
  assert.equal(t.leads.length, 2, "no second inquiry for the same wamid");
}

// 5. "הסר": consent opted_out, ONE service reply, no inquiry
{
  const t = makeDeps({ customers: [DANA], openCardId: "card-A" });
  const r = await handleWebhookEvents([inbound("wamid.5", "2026-10-21T09:00:00.000Z", "הסר")], t.deps);
  assert.equal(r.optOuts, 1);
  assert.equal(r.inquiries, 0);
  assert.equal(t.leads.length, 0);
  assert.deepEqual(t.sent, [{ to: "972541234567", text: OPT_OUT_REPLY }]);
  const consent = t.customerPatches.find((p) => p.patch.waConsent);
  assert.deepEqual({ id: consent?.id, state: consent?.patch.waConsent, source: consent?.patch.waConsentSource }, { id: "c-dana", state: "opted_out", source: "reply" });
}

// 6. echo before any inbound: stored with no customer, no inquiry; the first inbound then attaches the orphans
{
  const t = makeDeps({ customers: [], openCardId: null });
  const r = await handleWebhookEvents([echo("wamid.E", "2026-10-21T08:00:00.000Z", "שלום, מדבר יוסי ממגה")], t.deps);
  assert.deepEqual({ stored: r.stored, inquiries: r.inquiries }, { stored: 1, inquiries: 0 });
  assert.equal(t.messages[0].direction, "out");
  assert.equal(t.messages[0].origin, "app");
  assert.equal(t.messages[0].customerId, null);
  assert.equal(t.messages[0].phone, "972541234567", "an echo is keyed by the CUSTOMER's number");
  assert.equal(t.messages[0].status, "sent");
  const r2 = await handleWebhookEvents([inbound("wamid.6", "2026-10-21T09:00:00.000Z", "היי")], t.deps);
  assert.equal(r2.inquiries, 1);
  assert.equal(t.leads[0].customerId?.startsWith("c-new-"), true, "the lead created the customer");
  assert.deepEqual(t.attached, [{ key: "972541234567", customerId: t.leads[0].customerId! }], "orphans of that FULL number are attached to the new customer");
  assert.equal(t.messages[1].caseId, t.leads[0].id, "a new case, not a join");
}

// 7. picks the customer leads_fill would pick: two customers share the key -> the LOWEST customer_no
{
  const other: WaCustomerLite = { ...DANA, id: "c-older", customerNo: 1000 };
  const t = makeDeps({ customers: [DANA, other], openCardId: null });
  await handleWebhookEvents([inbound("wamid.7", "2026-10-21T09:00:00.000Z", "היי")], t.deps);
  assert.equal(t.messages[0].customerId, "c-older");
}

// 7b. a key collision across country codes never binds: a UK number sharing the last 9 digits is not Dana
{
  const uk: WaCustomerLite = { ...DANA, id: "c-uk", customerNo: 999, phones: ["+44 7700 541234567"] };
  const t = makeDeps({ customers: [uk], openCardId: "card-UK" });
  await handleWebhookEvents([inbound("wamid.7b", "2026-10-21T09:00:00.000Z", "היי")], t.deps);
  assert.equal(t.messages[0].customerId === "c-uk", false, "the sender 972541234567 is not the UK customer");
  assert.equal(t.customerPatches.some((p) => p.id === "c-uk"), false, "nothing is stamped on the UK customer");
  // an event whose number yields no key is skipped, never filed under ""
  const r = await handleWebhookEvents([inbound("wamid.7c", "2026-10-21T09:00:00.000Z", "היי", { from: "12" })], t.deps);
  assert.deepEqual({ stored: r.stored, skipped: r.skipped, errors: r.errors }, { stored: 0, skipped: 1, errors: [] });
}

// 8. a status event updates the row; a template event upserts; an unknown phone id is skipped with a warning
{
  const t = makeDeps({ customers: [DANA] });
  const r = await handleWebhookEvents(
    [
      { kind: "status", phoneNumberId: "111", waMessageId: "wamid.1", status: "read", at: "2026-10-21T09:01:00.000Z", error: null },
      { kind: "template", wabaId: "222", name: "offer_sent", language: "he", status: "APPROVED", reason: null },
      inbound("wamid.8", "2026-10-21T09:00:00.000Z", "היי", { phoneNumberId: "999" }),
      { kind: "template", wabaId: "000", name: "x", language: "he", status: "APPROVED", reason: null },
    ],
    t.deps,
  );
  assert.deepEqual(t.statusUpdates, [{ id: "wamid.1", status: "read", error: null }]);
  assert.deepEqual(t.templates, [{ companyId: "co-1", name: "offer_sent", status: "APPROVED" }]);
  assert.equal(r.skipped, 2, "the unknown phone id and the unknown waba are skipped");
  assert.equal(r.errors.length, 0, "skipped is not an error");
  assert.ok(t.warnings.some((w) => w.includes("999")), "the unknown id is named in a warning");
}

// 9. a sticker opens an inquiry with its stand-in text; an image's media is stored; a broken download keeps the row
{
  const t = makeDeps({ customers: [DANA], openCardId: null });
  await handleWebhookEvents(
    [
      inbound("wamid.9", "2026-10-21T09:00:00.000Z", "[סטיקר]", { type: "sticker", media: { id: "m1", mime: "image/webp", sha256: null, caption: null } }),
      inbound("wamid.10", "2026-10-21T09:01:00.000Z", "הדרכון", { type: "image", media: { id: "broken", mime: "image/jpeg", sha256: null, caption: "הדרכון" } }),
    ],
    t.deps,
  );
  assert.equal(t.leads[0].message, "[סטיקר]");
  assert.deepEqual(t.messages[0].media, { id: "m1", mime: "image/webp", sha256: null, caption: null, storage_path: "wa/co-1/m1.bin" });
  assert.deepEqual(t.messages[1].media, { id: "broken", mime: "image/jpeg", sha256: null, caption: "הדרכון", storage_path: null });
}

// 10. history rows: stored both ways, no inquiry, no consent, no media download; a missing table is a skip, not an error
{
  const t = makeDeps({ customers: [DANA], openCardId: "card-A" });
  const r = await handleWebhookEvents(
    [
      inbound("wamid.H1", "2026-08-01T09:00:00.000Z", "שלום", { origin: "history" }),
      echo("wamid.H2", "2026-08-01T09:05:00.000Z", "שלום לך", "history"),
      inbound("wamid.H3", "2026-08-01T09:06:00.000Z", "הסר", { origin: "history" }),
      inbound("wamid.H4", "2026-08-01T09:07:00.000Z", "[תמונה]", { origin: "history", type: "image", media: { id: "m9", mime: "image/jpeg", sha256: null, caption: null } }),
    ],
    t.deps,
  );
  assert.deepEqual({ stored: r.stored, inquiries: r.inquiries, optOuts: r.optOuts }, { stored: 4, inquiries: 0, optOuts: 0 });
  assert.equal(t.sent.length, 0);
  assert.equal(t.messages[3].media?.storage_path, null, "history media is not downloaded");
  assert.equal(t.customerPatches.length, 0, "history stamps nothing on the customer");
  const broken = makeDeps({ customers: [DANA], insertFails: true });
  const r2 = await handleWebhookEvents([inbound("wamid.11", "2026-10-21T09:00:00.000Z", "היי")], broken.deps);
  assert.deepEqual({ stored: r2.stored, skipped: r2.skipped, errors: r2.errors }, { stored: 0, skipped: 1, errors: [] });
  assert.equal(broken.leads.length, 0, "nothing is routed when the message could not be stored");
}


  // ---- review fixes (21.10)
  // (1) a history chunk stamps the account's history_synced_at; an unknown number is skipped
  {
    const { deps } = makeDeps();
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    deps.patchAccount = async (id, patch) => {
      patches.push({ id, patch });
    };
    const out = await handleWebhookEvents([{ kind: "history", phoneNumberId: "111", phase: 0, chunkOrder: 1, progress: 100 }], deps);
    assert.equal(out.errors.length, 0);
    assert.equal(patches.length, 1);
    assert.equal(typeof patches[0].patch.historySyncedAt, "string");
    const unknown = await handleWebhookEvents([{ kind: "history", phoneNumberId: "999", phase: 0, chunkOrder: 1, progress: 100 }], deps);
    assert.equal(unknown.skipped, 1);
  }
  // (2) the gap is measured against the newest LIVE inbound: a history row yesterday is no reason to stay quiet today
  {
    const { deps, leads } = makeDeps();
    await handleWebhookEvents([inbound("h1", "2026-10-20T12:00:00Z", "היי", { origin: "history" })], deps);
    assert.equal(leads.length, 0, "history opens nothing");
    await handleWebhookEvents([inbound("l1", "2026-10-21T09:00:00Z", "יש מקום?")], deps);
    assert.equal(leads.length, 1, "the first live message after onboarding opens an inquiry even inside 24 h of a history row");
  }
  // (3) a history chunk pays no gap read and one customer lookup per phone; a re-delivered batch pays no read at all
  {
    const { deps, messages } = makeDeps();
    let gapReads = 0;
    let customerReads = 0;
    const lastInbound = deps.lastInbound;
    const findCustomers = deps.findCustomers;
    deps.lastInbound = async (c, k) => {
      gapReads += 1;
      return lastInbound(c, k);
    };
    deps.findCustomers = async (c, k) => {
      customerReads += 1;
      return findCustomers(c, k);
    };
    const chunk = [
      inbound("h1", "2026-09-01T10:00:00Z", "a", { origin: "history" }),
      inbound("h2", "2026-09-01T10:01:00Z", "b", { origin: "history" }),
      echo("h3", "2026-09-01T10:02:00Z", "c", "history"),
    ];
    const out = await handleWebhookEvents(chunk, deps);
    assert.equal(out.stored, 3);
    assert.equal(gapReads, 0, "history never opens an inquiry, so the gap is never read");
    assert.equal(customerReads, 1, "one customer lookup per phone per batch");
    gapReads = 0;
    customerReads = 0;
    const again = await handleWebhookEvents(chunk, deps);
    assert.equal(again.skipped, 3);
    assert.equal(customerReads, 0, "already-stored ids are known before any read");
    assert.equal(messages.length, 3);
  }
  // (8) a message whose previous inbound has no case (the lead insert failed) opens the inquiry now, not in 24 h
  {
    const { deps, leads, messages } = makeDeps();
    const real = deps.insertLead;
    deps.insertLead = async () => {
      throw new Error("leads_fill failed");
    };
    const first = await handleWebhookEvents([inbound("m1", "2026-10-21T09:00:00Z", "היי")], deps);
    assert.equal(first.errors.length, 1);
    deps.insertLead = real;
    const second = await handleWebhookEvents([inbound("m2", "2026-10-21T10:00:00Z", "עוד שאלה")], deps);
    assert.equal(second.inquiries, 1, "the previous inbound carries no case - the conversation is caseless, open it now");
    assert.equal(messages.find((m) => m.waMessageId === "m2")?.caseId, leads[0].id);
  }
console.log("whatsapp-inbound-selftest ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
