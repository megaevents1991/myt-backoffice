// scripts/whatsapp-webhook-selftest.ts - `npx tsx scripts/whatsapp-webhook-selftest.ts`
// The webhook handler (lib/services/whatsapp-webhook.ts) with its env and its deps injected: Meta's GET handshake,
// the signature gate on POST, a signed batch reaching the inbound flow, a signed body that is not JSON, the
// missing-secret case. No DB, no network, no dev server - the route file is a thin wrapper over these two functions.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handleVerify, handleWebhookPost, type WebhookEnv } from "../lib/services/whatsapp-webhook";
import type { InboundDeps } from "../lib/services/whatsapp-inbound";
import type { WaAccount } from "../lib/services/whatsapp-db";

const ENV: WebhookEnv = { appSecret: "app-secret", verifyToken: "verify-me" };
const sign = (body: string, secret = ENV.appSecret ?? ""): string => "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

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

const never = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} must not be called`);
};

function makeDeps() {
  const warnings: string[] = [];
  const errors: string[] = [];
  const stored: string[] = [];
  const leads: string[] = [];
  const deps: InboundDeps = {
    now: () => "2026-10-21T10:00:00.000Z",
    accountByPhoneId: async (id) => (id === "111" ? ACCOUNT : null),
    accountByWabaId: async () => null,
    patchAccount: async () => {},
    insertMessage: async (row) => {
      stored.push(row.waMessageId);
      return { inserted: true, id: `m-${stored.length}` };
    },
    linkMessage: async () => {},
    updateStatus: async () => true,
    lastInbound: async () => null,
    findCustomers: async () => [],
    setCustomerFields: never("setCustomerFields"),
    insertLead: async (row) => {
      leads.push(row.message);
      return { id: `lead-${leads.length}`, caseNo: 1001, joinedIntoId: null, customerId: null };
    },
    attachOrphans: never("attachOrphans"),
    storeMedia: never("storeMedia"),
    sendServiceText: never("sendServiceText"),
    upsertTemplate: never("upsertTemplate"),
    log: { warn: (m) => warnings.push(m), error: (m) => errors.push(m) },
  };
  return { deps, warnings, errors, stored, leads };
}

const BATCH = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "222",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "972542272554", phone_number_id: "111" },
            contacts: [{ profile: { name: "דנה" }, wa_id: "972541234567" }],
            messages: [{ from: "972541234567", id: "wamid.A", timestamp: "1792576800", type: "text", text: { body: "היי, יש מקום בטיול?" } }],
          },
        },
      ],
    },
  ],
});

async function main(): Promise<void> {
  // ---- GET: Meta's handshake
  const url = (token: string) => new URL(`http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`);
  assert.deepEqual(handleVerify(url("verify-me"), ENV), { status: 200, text: "1158201444" });
  assert.deepEqual(handleVerify(url("wrong"), ENV), { status: 403, text: "forbidden" });
  assert.deepEqual(handleVerify(url("verify-me"), { ...ENV, verifyToken: null }), { status: 403, text: "forbidden" }, "no token configured = nobody verifies");
  assert.deepEqual(handleVerify(new URL("http://localhost/api/whatsapp/webhook"), ENV), { status: 403, text: "forbidden" }, "a bare GET is not a handshake");
  assert.equal(handleVerify(url("verify-me"), { ...ENV, verifyToken: "verify-me " }).status, 403, "exact match, no trimming of the stored value");

  // ---- POST: the signature gate
  {
    const { deps, errors } = makeDeps();
    const answer = await handleWebhookPost(BATCH, sign(BATCH), { ...ENV, appSecret: null }, deps);
    assert.deepEqual(answer, { status: 401, body: { ok: false, error: "unauthorized" } }, "no app secret = nothing is trusted");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /NEXT_SECRET_WHATSAPP_APP_SECRET/);
  }
  {
    const { deps, stored } = makeDeps();
    assert.deepEqual(await handleWebhookPost(BATCH, "sha256=00", ENV, deps), { status: 401, body: { ok: false, error: "unauthorized" } });
    assert.deepEqual(await handleWebhookPost(BATCH, null, ENV, deps), { status: 401, body: { ok: false, error: "unauthorized" } });
    assert.deepEqual(await handleWebhookPost(BATCH, sign(BATCH, "other-secret"), ENV, deps), { status: 401, body: { ok: false, error: "unauthorized" } });
    assert.deepEqual(stored, [], "nothing touched the deps");
  }

  // ---- POST: a signed batch reaches the inbound flow
  {
    const { deps, stored, leads, errors, warnings } = makeDeps();
    const answer = await handleWebhookPost(BATCH, sign(BATCH), ENV, deps);
    assert.deepEqual(answer, { status: 200, body: { ok: true, events: 1, stored: 1, skipped: 0, inquiries: 1, optOuts: 0, statuses: 0, errors: 0 } });
    assert.deepEqual(stored, ["wamid.A"]);
    assert.deepEqual(leads, ["היי, יש מקום בטיול?"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, ["[whatsapp] events=1 stored=1 inquiries=1 errors=0"], "one line per batch");
  }

  // ---- POST: signed, but not JSON - Meta signed it, so it is theirs: 200 and a warning, never a retry storm
  {
    const { deps, warnings } = makeDeps();
    const junk = "<html>not json</html>";
    assert.deepEqual(await handleWebhookPost(junk, sign(junk), ENV, deps), { status: 200, body: { ok: true, events: 0, stored: 0, skipped: 0, inquiries: 0, optOuts: 0, statuses: 0, errors: 0 } });
    assert.ok(warnings.some((w) => /not JSON/.test(w)), warnings.join(" | "));
  }

  // ---- POST: a signed batch for a number we do not have is skipped, still 200
  {
    const { deps } = makeDeps();
    const other = BATCH.replace('"phone_number_id":"111"', '"phone_number_id":"999"');
    const answer = await handleWebhookPost(other, sign(other), ENV, deps);
    assert.equal(answer.status, 200);
    assert.equal((answer.body as { skipped: number }).skipped, 1);
  }

  // ---- POST: a dep that throws is counted, the answer is still 200 (Meta must not re-deliver forever)
  {
    const { deps, errors } = makeDeps();
    deps.insertMessage = async () => {
      throw new Error("db down");
    };
    const answer = await handleWebhookPost(BATCH, sign(BATCH), ENV, deps);
    assert.equal(answer.status, 200);
    assert.equal((answer.body as { errors: number }).errors, 1);
    assert.ok(errors.some((e) => /db down/.test(e)));
  }
}

main().then(
  () => console.log("whatsapp-webhook-selftest ok"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
