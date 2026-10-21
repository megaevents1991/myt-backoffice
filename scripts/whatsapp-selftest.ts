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

// ---- one line for chips
assert.equal(previewText("שלום\nמה המחיר?", 10), "שלום מה ה…");
assert.equal(previewText("קצר", 10), "קצר");
assert.equal(previewText(null), "");

console.log("whatsapp-selftest ok");
