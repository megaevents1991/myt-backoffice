// scripts/whatsapp-selftest.ts - `npx tsx scripts/whatsapp-selftest.ts`
// Pure only: the WhatsApp rules (lib/whatsapp/rules.ts) - when a message opens an inquiry, the 24-hour
// window, the opt-out words, Meta's webhook signature, the webhook parser over Meta's payload shapes.
// No DB, no network.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  OPT_OUT_REPLY,
  WA_INQUIRY_GAP_HOURS,
  WA_WINDOW_HOURS,
  canSendText,
  isOptOut,
  parseWebhook,
  previewText,
  shouldOpenInquiry,
  standInText,
  verifySignature,
  type WaEvent,
} from "../lib/whatsapp/rules";
import { envKey, phoneIdFor, tokenFor } from "../lib/whatsapp/env";
import { WA_TEXT_MAX, parseSignupInput } from "../lib/whatsapp/rules";
import {
  RateGate,
  createMetaProvider,
  explain,
  mediaExtension,
  isInlineMedia,
  mediaStoragePath,
  metaProvider,
  safeContentType,
  providerFor,
  templateBlock,
  templateBody,
  textBody,
  type WaProvider,
} from "../lib/whatsapp/meta-provider";
import type { WaTemplate } from "../lib/services/whatsapp-db";

const NOW = "2026-10-21T10:00:00Z";

// ---- one inquiry per conversation
assert.equal(WA_INQUIRY_GAP_HOURS, 24);
assert.equal(shouldOpenInquiry(null, NOW), true, "first message ever opens an inquiry");
assert.equal(shouldOpenInquiry("2026-10-21T09:00:00Z", NOW), false, "a message an hour after the last one does not");
assert.equal(shouldOpenInquiry("2026-10-20T09:59:00Z", NOW), true, "a message after a 24h gap does");
assert.equal(shouldOpenInquiry("2026-10-20T10:00:00Z", NOW), true, "exactly 24h counts as a gap");

// ---- the 24-hour window for free-text replies
assert.equal(WA_WINDOW_HOURS, 24);
assert.equal(canSendText("2026-10-21T09:00:00Z", NOW), true);
assert.equal(canSendText("2026-10-20T09:00:00Z", NOW), false);
assert.equal(canSendText("2026-10-20T10:00:00Z", NOW), false, "exactly 24h is closed");
assert.equal(canSendText(null, NOW), false, "never wrote = no window");

// ---- opt-out words
assert.equal(isOptOut("הסר"), true);
assert.equal(isOptOut("  STOP. "), true);
assert.equal(isOptOut("הסר אותי מהרשימה"), true, "first word");
assert.equal(isOptOut("להסרה"), true);
assert.equal(isOptOut("unsubscribe please"), true);
assert.equal(isOptOut("אל תסירו אותי"), false);
assert.equal(isOptOut("כן"), false);
assert.equal(isOptOut("מה המחיר להסרת כתמים"), false, "a later word is not an opt-out");
assert.equal(isOptOut(null), false);
assert.equal(isOptOut(""), false);
assert.equal(OPT_OUT_REPLY, "הוסרת מרשימת התפוצה שלנו. לכל שאלה אנחנו כאן.");

// ---- Meta's signature
const secret = "s3cr3t";
const body = '{"object":"whatsapp_business_account"}';
const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
assert.equal(verifySignature(body, good, secret), true);
assert.equal(verifySignature(body, good.toUpperCase().replace("SHA256=", "sha256="), secret), false, "hex case matters - no normalisation");
assert.equal(verifySignature(body, "sha256=00", secret), false, "wrong length");
assert.equal(verifySignature(body + " ", good, secret), false, "a changed body");
assert.equal(verifySignature(body, null, secret), false);
assert.equal(verifySignature(body, good, ""), false, "no secret = never valid");

// ---- the parser: an inbound text, a sticker, a reaction, a delivery status
const FIXTURE_MESSAGES = {
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
            messages: [
              { from: "972541234567", id: "wamid.A", timestamp: "1792576800", type: "text", text: { body: "היי" } },
              { from: "972541234567", id: "wamid.B", timestamp: "1792576801", type: "sticker", sticker: { id: "m1", mime_type: "image/webp", sha256: "abc", animated: false } },
              { from: "972541234567", id: "wamid.C", timestamp: "1792576802", type: "reaction", reaction: { message_id: "wamid.A", emoji: "👍" } },
            ],
            statuses: [{ id: "wamid.A", status: "delivered", timestamp: "1792576860", recipient_id: "972541234567" }],
          },
        },
      ],
    },
  ],
};
const events = parseWebhook(FIXTURE_MESSAGES);
assert.equal(events.length, 4);
assert.deepEqual(events[0], {
  kind: "message",
  phoneNumberId: "111",
  waMessageId: "wamid.A",
  from: "972541234567",
  to: null,
  profileName: "דנה",
  type: "text",
  text: "היי",
  media: null,
  sentAt: "2026-10-21T10:00:00.000Z",
  origin: "customer",
  direction: "in",
});
const sticker = events[1] as Extract<WaEvent, { kind: "message" }>;
assert.equal(sticker.type, "sticker");
assert.equal(sticker.text, "[סטיקר]");
assert.deepEqual(sticker.media, { id: "m1", mime: "image/webp", sha256: "abc", caption: null });
const reaction = events[2] as Extract<WaEvent, { kind: "message" }>;
assert.equal(reaction.type, "reaction");
assert.equal(reaction.text, "👍");
assert.deepEqual(events[3], { kind: "status", phoneNumberId: "111", waMessageId: "wamid.A", status: "delivered", at: "2026-10-21T10:01:00.000Z", error: null });

// a failed status carries Meta's error sentence
const failed = parseWebhook({
  entry: [{ id: "222", changes: [{ field: "messages", value: { metadata: { phone_number_id: "111" }, statuses: [{ id: "wamid.F", status: "failed", timestamp: "1792576860", errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable", error_data: { details: "Message Undeliverable." } }] }] } }] }],
});
assert.deepEqual(failed[0], { kind: "status", phoneNumberId: "111", waMessageId: "wamid.F", status: "failed", at: "2026-10-21T10:01:00.000Z", error: "131026: Message Undeliverable." });

// an image with a caption keeps the caption as the text; an unknown type is "unsupported"
const media = parseWebhook({
  entry: [{ id: "222", changes: [{ field: "messages", value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "x" }, wa_id: "972541234567" }], messages: [
    { from: "972541234567", id: "wamid.I", timestamp: "1792576800", type: "image", image: { id: "m2", mime_type: "image/jpeg", sha256: "s", caption: "הדרכון" } },
    { from: "972541234567", id: "wamid.U", timestamp: "1792576800", type: "order", order: {} },
  ] } }] }],
}) as Extract<WaEvent, { kind: "message" }>[];
assert.equal(media[0].text, "הדרכון");
assert.equal(media[0].media?.caption, "הדרכון");
assert.equal(media[1].type, "unsupported");
assert.equal(media[1].text, "[הודעה לא נתמכת]");
assert.equal(standInText("document"), "[קובץ]");

// ---- an echo: what a rep wrote from the WhatsApp Business app
const FIXTURE_ECHO = {
  entry: [{ id: "222", changes: [{ field: "smb_message_echoes", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "972542272554", phone_number_id: "111" }, message_echoes: [
    { from: "972542272554", to: "972541234567", id: "wamid.E", timestamp: "1792576900", type: "text", text: { body: "בטח, יש מקום" } },
  ] } }] }],
};
const echo = parseWebhook(FIXTURE_ECHO)[0] as Extract<WaEvent, { kind: "message" }>;
assert.equal(echo.origin, "app");
assert.equal(echo.direction, "out");
assert.equal(echo.from, "972542272554");
assert.equal(echo.to, "972541234567");
assert.equal(echo.text, "בטח, יש מקום");
assert.equal(echo.profileName, null);

// ---- history: the 6-month sync after onboarding, both directions in one thread
const FIXTURE_HISTORY = {
  entry: [{ id: "222", changes: [{ field: "history", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "972542272554", phone_number_id: "111" }, history: [
    { metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: "972541234567", messages: [
      { from: "972541234567", id: "wamid.H1", timestamp: "1790000000", type: "text", text: { body: "שלום" }, history_context: { status: "DELIVERED", from_me: false } },
      { from: "972542272554", id: "wamid.H2", timestamp: "1790000100", type: "text", text: { body: "שלום לך" }, history_context: { status: "SENT", from_me: true } },
    ] }] },
  ] } }] }],
};
const history = parseWebhook(FIXTURE_HISTORY) as Extract<WaEvent, { kind: "message" }>[];
assert.equal(history.length, 2);
assert.equal(history[0].origin, "history");
assert.equal(history[0].direction, "in");
assert.equal(history[0].to, null);
assert.equal(history[1].direction, "out");
assert.equal(history[1].to, "972541234567");
assert.equal(history[1].origin, "history");

// ---- a template's review result, an account event, and junk
const FIXTURE_TEMPLATE = { entry: [{ id: "222", changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_id: 1, message_template_name: "offer_sent", message_template_language: "he", reason: null } }] }] };
assert.deepEqual(parseWebhook(FIXTURE_TEMPLATE)[0], { kind: "template", wabaId: "222", name: "offer_sent", language: "he", status: "APPROVED", reason: null });
const account = parseWebhook({ entry: [{ id: "222", changes: [{ field: "phone_number_quality_update", value: { display_phone_number: "972542272554", event: "DOWNGRADE", current_limit: "TIER_1K" } }] }] });
assert.deepEqual(account[0], { kind: "account", wabaId: "222", field: "phone_number_quality_update", payload: { display_phone_number: "972542272554", event: "DOWNGRADE", current_limit: "TIER_1K" } });
assert.deepEqual(parseWebhook({ entry: [{ changes: [{ field: "something_else", value: {} }] }] }), []);
assert.deepEqual(parseWebhook(null), []);
assert.deepEqual(parseWebhook("not json"), []);
assert.deepEqual(parseWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "111" }, messages: [{ id: "wamid.X" }] } }] }] }), [], "a message with no sender is skipped");

// ---- env: the sending token per company, the phone id key per slug
assert.equal(tokenFor("mega-family", { NEXT_SECRET_WHATSAPP_TOKEN: "shared" }), "shared");
assert.equal(tokenFor("mega-family", { NEXT_SECRET_WHATSAPP_TOKEN: "shared", NEXT_SECRET_WHATSAPP_TOKEN_MEGA_FAMILY: "own" }), "own", "a company's own token wins");
assert.equal(tokenFor("mega-family", { NEXT_SECRET_WHATSAPP_TOKEN: "  " }), null, "blank is unset");
assert.equal(tokenFor("mega-family", {}), null);
assert.equal(envKey("mega-family"), "NEXT_SECRET_WHATSAPP_PHONE_ID_MEGA_FAMILY");
assert.equal(envKey("mega-events"), "NEXT_SECRET_WHATSAPP_PHONE_ID_MEGA_EVENTS");
assert.equal(phoneIdFor("mega-family", { NEXT_SECRET_WHATSAPP_PHONE_ID_MEGA_FAMILY: "123456789012" }), "123456789012");
assert.equal(phoneIdFor("mega-family", { NEXT_SECRET_WHATSAPP_PHONE_ID_MEGA_FAMILY: "abc" }), null, "a phone id is digits");

// ---- the Embedded Signup answer (Task 8): the code and the two ids, checked before any Meta call
assert.deepEqual(parseSignupInput({ code: "AQBx-signup-code_123.456", phoneNumberId: "111222333", wabaId: "222333444", sharedHistory: true }), { ok: true, code: "AQBx-signup-code_123.456", phoneNumberId: "111222333", wabaId: "222333444", sharedHistory: true });
assert.deepEqual(parseSignupInput({ code: " AQBx-signup-code_123.456 ", phoneNumberId: "111222333", wabaId: "222333444" }), { ok: true, code: "AQBx-signup-code_123.456", phoneNumberId: "111222333", wabaId: "222333444", sharedHistory: false }, "trimmed; history defaults to not shared");
assert.equal(parseSignupInput({ code: "", phoneNumberId: "111222333", wabaId: "222333444" }).ok, false, "no code");
assert.equal(parseSignupInput({ code: "AQBx-signup-code_123.456", phoneNumberId: "x", wabaId: "222333444" }).ok, false, "a phone id is digits");
assert.equal(parseSignupInput({ code: "AQBx-signup-code_123.456", phoneNumberId: "111222333", wabaId: "" }).ok, false, "no waba");
assert.equal(parseSignupInput({ code: "AQBx signup", phoneNumberId: "111222333", wabaId: "222333444" }).ok, false, "a code has no spaces inside");
assert.equal(parseSignupInput({ code: "x".repeat(5000), phoneNumberId: "111222333", wabaId: "222333444" }).ok, false, "too long");
assert.equal(parseSignupInput(null).ok, false);
assert.equal(parseSignupInput({ code: "AQBx-signup-code_123.456", phoneNumberId: 111222333, wabaId: "222333444" }).ok, false, "a number is not an id string");
// ---- one line for chips
assert.equal(previewText("שלום\nמה המחיר?", 10), "שלום מה ה…");
assert.equal(previewText("קצר", 10), "קצר");
assert.equal(previewText(null), "");

// the provider calls are async - the rest of the file stays flat
async function main(): Promise<void> {
  // ---- the Meta provider (lib/whatsapp/meta-provider.ts): pure helpers + the Graph calls over a stub fetch
  assert.equal(explain(400, { error: { code: 131042 } }), "The WhatsApp account has no payment method - add one in WhatsApp Manager.");
  assert.equal(explain(400, { error: { code: 131047 } }), "More than 24 hours since the customer last wrote - only a template can be sent.");
  assert.equal(explain(500, null), "WhatsApp refused the message (500): no details");

  const TEMPLATE_ARGS = { to: "972541234567", template: "booking_link", language: "he", params: ["דנה", " ", "https://x"] };
  assert.deepEqual(templateBody(TEMPLATE_ARGS), {
    messaging_product: "whatsapp",
    to: "972541234567",
    type: "template",
    template: {
      name: "booking_link",
      language: { code: "he" },
      components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }, { type: "text", text: "-" }, { type: "text", text: "https://x" }] }],
    },
  });
  assert.deepEqual(templateBody({ ...TEMPLATE_ARGS, params: [] }).template.components, [], "no params = no body component");
  assert.deepEqual(textBody("972541234567", "היי"), { messaging_product: "whatsapp", to: "972541234567", type: "text", text: { body: "היי", preview_url: false } });
  assert.equal(textBody("972541234567", "x".repeat(WA_TEXT_MAX + 5)).text.body.length, WA_TEXT_MAX, "capped at the Meta limit");

  assert.equal(mediaExtension("image/jpeg"), "jpg");
  assert.equal(mediaExtension("image/png"), "png");
  assert.equal(mediaExtension("image/webp"), "webp");
  assert.equal(mediaExtension("application/pdf"), "pdf");
  assert.equal(mediaExtension("audio/ogg; codecs=opus"), "ogg");
  assert.equal(mediaExtension("video/mp4"), "mp4");
  assert.equal(mediaExtension(""), "bin");
  assert.equal(mediaStoragePath("co-1", "1234567890", "image/jpeg"), "co-1/1234567890.jpg");
  assert.equal(mediaStoragePath("co-1", "a/../b", "image/png"), "co-1/a____b.png", "a media id is never a path");
  // what the bucket is told the file IS: only a type this build names - a declared text/html must never render from our storage
  assert.equal(safeContentType("image/jpeg; charset=x"), "image/jpeg");
  assert.equal(safeContentType("IMAGE/PNG"), "image/png");
  assert.equal(safeContentType("text/html"), "application/octet-stream");
  assert.equal(safeContentType("image/svg+xml"), "application/octet-stream", "svg scripts - not an allowed picture");
  assert.equal(safeContentType(""), "application/octet-stream");
  assert.equal(isInlineMedia("image/jpeg"), true);
  assert.equal(isInlineMedia("application/pdf"), false, "a file is downloaded, never rendered from the bucket");

  const CACHE: WaTemplate[] = [
    { name: "booking_link", language: "he", category: "UTILITY", status: "APPROVED", body: null, paramCount: 3, syncedAt: NOW },
    { name: "offer", language: "he", category: "MARKETING", status: "PENDING", body: null, paramCount: 1, syncedAt: NOW },
  ];
  assert.equal(templateBlock([], "anything", "he"), null, "an empty cache (never synced) blocks nothing");
  assert.equal(templateBlock(CACHE, "booking_link", "he"), null);
  assert.equal(templateBlock(CACHE, "offer", "he"), `The template "offer" (he) is PENDING, not approved - check it in WhatsApp Manager.`);
  assert.equal(templateBlock(CACHE, "unknown", "he"), null, "a template the cache does not know is tried");
  assert.equal(templateBlock(CACHE, "offer", "en"), null, "a language the cache does not know is tried");

  // 5 sends a second per company
  {
    let clock = 0;
    const slept: number[] = [];
    const gate = new RateGate(5, { now: () => clock, sleep: async (msToWait) => { slept.push(msToWait); clock += msToWait; } });
    for (let i = 0; i < 5; i++) await gate.take("co-1");
    assert.deepEqual(slept, [], "five in a second pass at once");
    await gate.take("co-1");
    assert.equal(slept.length, 1, "the sixth waits");
    assert.ok(slept[0] > 0 && slept[0] <= 1000, `waits up to a second, not ${slept[0]}`);
    await gate.take("co-2");
    assert.equal(slept.length, 1, "another company has its own gate");
    clock += 2000;
    await gate.take("co-1");
    assert.equal(slept.length, 1, "a second later the gate is open again");
  }

  // the Graph calls, over a stub fetch
  type Answer = { status: number; body?: unknown; bytes?: ArrayBuffer; throws?: Error };
  type Call = { url: string; method: string; auth: string | null; body: unknown };
  function stubFetch(answers: Record<string, Answer>, calls: Call[]): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const hit = Object.entries(answers).find(([needle]) => url.includes(needle));
      if (!hit) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      const a = hit[1];
      if (a.throws) throw a.throws;
      if (a.bytes) return new Response(a.bytes, { status: a.status, headers: { "content-type": "image/jpeg" } });
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }
  const CFG = { token: "tok-1", phoneId: "111" };
  const provider = (answers: Record<string, Answer>, calls: Call[] = []): [WaProvider, Call[]] => [createMetaProvider(stubFetch(answers, calls)), calls];

  {
    const [p, calls] = provider({ "/111/messages": { status: 200, body: { messages: [{ id: "wamid.S" }] } } });
    assert.deepEqual(await p.sendTemplate(CFG, TEMPLATE_ARGS), { ok: true, messageId: "wamid.S" });
    assert.equal(calls[0].url, "https://graph.facebook.com/v26.0/111/messages");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].auth, "Bearer tok-1");
    assert.deepEqual(calls[0].body, templateBody(TEMPLATE_ARGS));
    assert.deepEqual(await p.sendText(CFG, { to: "972541234567", text: "היי" }), { ok: true, messageId: "wamid.S" });
    assert.deepEqual(calls[1].body, textBody("972541234567", "היי"));
  }
  {
    const [p] = provider({ "/111/messages": { status: 400, body: { error: { code: 132001, message: "Template name does not exist" } } } });
    assert.deepEqual(await p.sendTemplate(CFG, TEMPLATE_ARGS), { ok: false, error: "The message template is not approved yet (or its name / language differs) - check it in WhatsApp Manager." });
  }
  {
    const timeout = new Error("t");
    timeout.name = "TimeoutError";
    const [p] = provider({ "/111/messages": { status: 0, throws: timeout } });
    assert.deepEqual(await p.sendText(CFG, { to: "972541234567", text: "x" }), { ok: false, error: "WhatsApp did not answer in time - try again." });
    const [q] = provider({ "/111/messages": { status: 0, throws: new Error("ECONNRESET") } });
    assert.deepEqual(await q.sendText(CFG, { to: "972541234567", text: "x" }), { ok: false, error: "WhatsApp could not be reached - try again." });
  }
  {
    const [p, calls] = provider({
    // the stub answers the FIRST needle a url contains - the second page must be listed first
    "after=abc": { status: 200, body: { data: [{ name: "page2", language: "he", category: "UTILITY", status: "PENDING", components: [{ type: "BODY", text: "x" }] }] } },
      "/222/message_templates?": {
        status: 200,
        body: {
          data: [
            { name: "booking_link", language: "he", category: "UTILITY", status: "APPROVED", components: [{ type: "HEADER", format: "TEXT", text: "מגה" }, { type: "BODY", text: "שלום {{1}}, הטיול {{2}}: {{3}}" }] },
            { name: "hello", language: "en", category: "MARKETING", status: "REJECTED", components: [] },
          ],
          paging: { next: "https://graph.facebook.com/v26.0/222/message_templates?after=abc" },
        },
      },
      });
    const list = await p.listTemplates("tok-1", "222");
    assert.ok(calls[0].url.startsWith("https://graph.facebook.com/v26.0/222/message_templates?fields=name,language,category,status,components"), calls[0].url);
    assert.deepEqual(list, [
      { name: "booking_link", language: "he", category: "UTILITY", status: "APPROVED", body: "שלום {{1}}, הטיול {{2}}: {{3}}", paramCount: 3 },
      { name: "hello", language: "en", category: "MARKETING", status: "REJECTED", body: null, paramCount: 0 },
      { name: "page2", language: "he", category: "UTILITY", status: "PENDING", body: "x", paramCount: 0 },
    ]);
    assert.equal(calls.length, 2, "paging.next is followed");
  }
  {
    const [p, calls] = provider({ "/111/smb_app_data": { status: 200, body: { messaging_product: "whatsapp", request_id: "req-1" } }, "/222/subscribed_apps": { status: 200, body: { success: true } } });
    assert.deepEqual(await p.requestHistorySync(CFG), { ok: true, messageId: "req-1" });
    assert.deepEqual(calls[0].body, { messaging_product: "whatsapp", sync_type: "history" });
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(await p.subscribeApp("tok-1", "222"), { ok: true, messageId: null });
    assert.equal(calls[1].url, "https://graph.facebook.com/v26.0/222/subscribed_apps");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].auth, "Bearer tok-1");
  }
  {
    const bytes = new Uint8Array([255, 216, 255]);
    const [p, calls] = provider({ "/v26.0/m1": { status: 200, body: { url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=m1", mime_type: "image/jpeg", sha256: "s" } }, "lookaside": { status: 200, bytes: bytes.buffer as ArrayBuffer } });
    const media = await p.downloadMedia("tok-1", "m1");
    assert.deepEqual(media, { bytes, mime: "image/jpeg" });
    assert.equal(calls[1].auth, "Bearer tok-1", "the media url needs the bearer too");
    const [q] = provider({ "/v26.0/m2": { status: 404, body: { error: { code: 100 } } } });
    assert.equal(await q.downloadMedia("tok-1", "m2"), null, "a media that is gone is null, not a throw");
  }
  {
    const [p, calls] = provider({ "/111?fields=": { status: 200, body: { display_phone_number: "+972 54-227-2554", verified_name: "Mega Family", quality_rating: "GREEN", platform_type: "CLOUD_API", is_on_biz_app: true } } });
    assert.deepEqual(await p.phoneInfo("tok-1", "111"), { displayPhone: "+972 54-227-2554", verifiedName: "Mega Family", qualityRating: "GREEN", platformType: "CLOUD_API", isOnBizApp: true });
    assert.ok(calls[0].url.includes("fields=display_phone_number,verified_name,quality_rating,platform_type,is_on_biz_app"), calls[0].url);
    const [q] = provider({ "/111?fields=": { status: 400, body: { error: { message: "nope" } } } });
    assert.equal(await q.phoneInfo("tok-1", "111"), null);
  }
  {
    const [p, calls] = provider({ "/oauth/access_token": { status: 200, body: { access_token: "EAAB-long", token_type: "bearer" } } });
    assert.deepEqual(await p.exchangeCode({ appId: "2120", appSecret: "shh", code: "AQ..1" }), { token: "EAAB-long" });
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url, "https://graph.facebook.com/v26.0/oauth/access_token?client_id=2120&client_secret=shh&code=AQ..1");
    const [q] = provider({ "/oauth/access_token": { status: 400, body: { error: { message: "Invalid verification code format." } } } });
    const failed = await q.exchangeCode({ appId: "2120", appSecret: "shh", code: "bad" });
    assert.ok("error" in failed && !failed.error.includes("shh"), "the secret never rides in an error");
  }
  {
    // the numbers of a WABA - what a signup's phone id is checked against before it is stored
    const [p, calls] = provider({ "/222/phone_numbers": { status: 200, body: { data: [{ id: "111", display_phone_number: "+972 54-227-2554" }, { id: "112" }] } } });
    assert.deepEqual(await p.wabaPhoneNumbers("tok-1", "222"), ["111", "112"]);
    assert.ok(calls[0].url.startsWith("https://graph.facebook.com/v26.0/222/phone_numbers"), calls[0].url);
    assert.equal(calls[0].auth, "Bearer tok-1");
    const [q] = provider({ "/222/phone_numbers": { status: 400, body: { error: { message: "nope" } } } });
    assert.equal(await q.wabaPhoneNumbers("tok-1", "222"), null, "a refused read is null, never an empty list");
  }
  assert.equal(providerFor("meta"), metaProvider);
  assert.equal(providerFor("360dialog"), null, "a provider this build does not have");
}

main().then(
  () => console.log("whatsapp-selftest ok"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
