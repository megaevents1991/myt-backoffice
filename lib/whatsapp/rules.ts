/**
 * WhatsApp rules - pure, no DB, no fetch (selftest: scripts/whatsapp-selftest.ts).
 *
 * Spec docs/superpowers/specs/2026-10-21-whatsapp-cloud-api-design.md (sections 6, 7, 9). Everything the
 * webhook and the sender decide lives here: when a customer's message opens an inquiry (one per
 * conversation, not per message), the 24-hour window a free-text reply needs, the opt-out words, Meta's
 * webhook signature, and the parser that turns Meta's payload into flat events.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** A new inbound message after this many hours of silence is a new conversation = a new inquiry. */
export const WA_INQUIRY_GAP_HOURS = 24;
/** A free-text (non-template) message may go out only this long after the customer last wrote. */
export const WA_WINDOW_HOURS = 24;
/** Thread page size on the card. */
export const WA_THREAD_PAGE = 50;
/** Meta's cap on a text body. */
export const WA_TEXT_MAX = 4096;
/** A reply that is one of these (alone, or as its first word) is an opt-out. */
export const OPT_OUT_WORDS = ["הסר", "להסרה", "הסירו אותי", "stop", "unsubscribe"] as const;
/** The one free service reply to an opt-out. */
export const OPT_OUT_REPLY = "הוסרת מרשימת התפוצה שלנו. לכל שאלה אנחנו כאן.";

const HOUR_MS = 3_600_000;
const ms = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** True when the customer's previous inbound message is older than the gap (or there is none). */
export function shouldOpenInquiry(lastInboundAt: string | null, now: string): boolean {
  if (!lastInboundAt) return true;
  const last = ms(lastInboundAt);
  const at = ms(now);
  if (last === null || at === null) return true;
  return at - last >= WA_INQUIRY_GAP_HOURS * HOUR_MS;
}

/** True while the 24-hour customer-service window is open (the customer wrote less than 24 h ago). */
export function canSendText(lastInboundAt: string | null, now: string): boolean {
  if (!lastInboundAt) return false;
  const last = ms(lastInboundAt);
  const at = ms(now);
  if (last === null || at === null) return false;
  return at - last < WA_WINDOW_HOURS * HOUR_MS;
}

/** The whole text, or its first word(s), is an opt-out word - punctuation and case ignored. */
export function isOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text
    .toLowerCase()
    .replace(/[.,!?;:'"״׳()[\]\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;
  return OPT_OUT_WORDS.some((w) => clean === w || clean.startsWith(`${w} `));
}

/** Meta's `X-Hub-Signature-256`: "sha256=" + hex HMAC-SHA256 of the RAW body with the app secret. */
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!secret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

// ---------------------------------------------------------------- the webhook parser

export type WaMessageType =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "sticker"
  | "location"
  | "contacts"
  | "template"
  | "reaction"
  | "unsupported";

export type WaMediaRef = { id: string; mime: string; sha256: string | null; caption: string | null };

export type WaOrigin = "customer" | "app" | "history";

export type WaEvent =
  | {
      /** A chunk of the 6-month history sync arrived (its messages ride as `message` events): how far the sync is. */
      kind: "history";
      phoneNumberId: string;
      phase: number | null;
      chunkOrder: number | null;
      progress: number | null;
    }
  | {
      kind: "message";
      phoneNumberId: string;
      waMessageId: string;
      /** The sender - the customer for an inbound message, the business number for an echo. */
      from: string;
      /** The customer for an outbound message (echo / history), null for an inbound one. */
      to: string | null;
      profileName: string | null;
      type: WaMessageType;
      text: string | null;
      media: WaMediaRef | null;
      sentAt: string;
      origin: WaOrigin;
      direction: "in" | "out";
    }
  | { kind: "status"; phoneNumberId: string; waMessageId: string; status: "sent" | "delivered" | "read" | "failed"; at: string; error: string | null }
  | { kind: "template"; wabaId: string; name: string; language: string; status: string; reason: string | null }
  | { kind: "account"; wabaId: string; field: string; payload: unknown };

const KNOWN_TYPES: ReadonlySet<string> = new Set<WaMessageType>([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "template",
  "reaction",
]);
const MEDIA_TYPES: ReadonlySet<string> = new Set(["image", "document", "audio", "video", "sticker"]);
const STATUSES: ReadonlySet<string> = new Set(["sent", "delivered", "read", "failed"]);
const ACCOUNT_FIELDS: ReadonlySet<string> = new Set(["account_update", "phone_number_quality_update"]);

const STAND_IN: Record<WaMessageType, string> = {
  text: "",
  image: "[תמונה]",
  document: "[קובץ]",
  audio: "[הודעה קולית]",
  video: "[וידאו]",
  sticker: "[סטיקר]",
  location: "[מיקום]",
  contacts: "[איש קשר]",
  template: "[תבנית]",
  reaction: "[תגובה]",
  unsupported: "[הודעה לא נתמכת]",
};

/** What a message with no text reads as on the card and in the inquiry. */
export const standInText = (type: WaMessageType): string => STAND_IN[type];

type Dict = Record<string, unknown>;
const obj = (v: unknown): Dict | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

const tsToIso = (ts: unknown): string => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

function messageEvent(
  raw: Dict,
  phoneNumberId: string,
  opts: { origin: WaOrigin; direction: "in" | "out"; to: string | null; profileName: string | null },
): WaEvent | null {
  const id = str(raw.id);
  const from = str(raw.from);
  if (!id || !from) return null;
  const rawType = str(raw.type) ?? "unsupported";
  const type: WaMessageType = KNOWN_TYPES.has(rawType) ? (rawType as WaMessageType) : "unsupported";
  let text: string | null = null;
  let media: WaMediaRef | null = null;
  if (type === "text") {
    text = str(obj(raw.text)?.body);
  } else if (MEDIA_TYPES.has(type)) {
    const m = obj(raw[type]);
    media = { id: str(m?.id) ?? "", mime: str(m?.mime_type) ?? "application/octet-stream", sha256: str(m?.sha256), caption: str(m?.caption) };
    text = media.caption ?? standInText(type);
  } else if (type === "reaction") {
    text = str(obj(raw.reaction)?.emoji) ?? standInText(type);
  } else {
    text = standInText(type);
  }
  return {
    kind: "message",
    phoneNumberId,
    waMessageId: id,
    from,
    to: opts.to,
    profileName: opts.profileName,
    type,
    text,
    media,
    sentAt: tsToIso(raw.timestamp),
    origin: opts.origin,
    direction: opts.direction,
  };
}

function statusError(raw: Dict): string | null {
  const first = obj(arr(raw.errors)[0]);
  if (!first) return null;
  const code = str(first.code);
  const details = str(obj(first.error_data)?.details) ?? str(first.message) ?? str(first.title) ?? "unknown error";
  return code ? `${code}: ${details}` : details;
}

/**
 * Meta's webhook body -> flat events. Never throws: anything that is not the shape it knows is skipped.
 * Fields: `messages` (inbound + statuses), `smb_message_echoes` (a rep wrote from the app), `history`
 * (the coexistence sync), `message_template_status_update`, `account_update`, `phone_number_quality_update`.
 */
export function parseWebhook(body: unknown): WaEvent[] {
  const out: WaEvent[] = [];
  const root = obj(body);
  if (!root) return out;
  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);
    if (!entry) continue;
    const wabaId = str(entry.id) ?? "";
    for (const changeRaw of arr(entry.changes)) {
      const change = obj(changeRaw);
      const field = str(change?.field);
      const value = obj(change?.value);
      if (!change || !field || !value) continue;
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id) ?? "";
      const businessPhone = str(obj(value.metadata)?.display_phone_number);

      if (field === "messages") {
        const contacts = arr(value.contacts).map(obj);
        for (const mRaw of arr(value.messages)) {
          const m = obj(mRaw);
          if (!m) continue;
          const from = str(m.from);
          const contact = contacts.find((c) => c && str(c.wa_id) === from) ?? contacts[0] ?? null;
          const ev = messageEvent(m, phoneNumberId, {
            origin: "customer",
            direction: "in",
            to: null,
            profileName: str(obj(contact?.profile)?.name),
          });
          if (ev) out.push(ev);
        }
        for (const sRaw of arr(value.statuses)) {
          const s = obj(sRaw);
          const id = str(s?.id);
          const status = str(s?.status);
          if (!s || !id || !status || !STATUSES.has(status)) continue;
          out.push({ kind: "status", phoneNumberId, waMessageId: id, status: status as "sent" | "delivered" | "read" | "failed", at: tsToIso(s.timestamp), error: statusError(s) });
        }
      } else if (field === "smb_message_echoes") {
        for (const eRaw of arr(value.message_echoes)) {
          const e = obj(eRaw);
          if (!e) continue;
          const ev = messageEvent(e, phoneNumberId, { origin: "app", direction: "out", to: str(e.to), profileName: null });
          if (ev) out.push(ev);
        }
      } else if (field === "history") {
        const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
        for (const chunkRaw of arr(value.history)) {
          const meta = obj(obj(chunkRaw)?.metadata);
          out.push({ kind: "history", phoneNumberId, phase: num(meta?.phase), chunkOrder: num(meta?.chunk_order), progress: num(meta?.progress) });
          for (const threadRaw of arr(obj(chunkRaw)?.threads)) {
            const thread = obj(threadRaw);
            const customer = str(thread?.id);
            for (const mRaw of arr(thread?.messages)) {
              const m = obj(mRaw);
              if (!m) continue;
              const ctx = obj(m.history_context);
              const fromMe = typeof ctx?.from_me === "boolean" ? ctx.from_me : businessPhone !== null && str(m.from) === businessPhone;
              const ev = messageEvent(m, phoneNumberId, {
                origin: "history",
                direction: fromMe ? "out" : "in",
                to: fromMe ? customer : null,
                profileName: null,
              });
              if (ev) out.push(ev);
            }
          }
        }
      } else if (field === "message_template_status_update") {
        const name = str(value.message_template_name);
        const status = str(value.event);
        if (!name || !status) continue;
        out.push({ kind: "template", wabaId, name, language: str(value.message_template_language) ?? "he", status, reason: str(value.reason) });
      } else if (ACCOUNT_FIELDS.has(field)) {
        out.push({ kind: "account", wabaId, field, payload: value });
      }
    }
  }
  return out;
}

/** One line for chips and inquiry previews: newlines collapsed, cut with an ellipsis. */
export function previewText(text: string | null | undefined, max = 80): string {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// ---------------------------------------------------------------- Embedded Signup

export type SignupInput = { code: string; phoneNumberId: string; wabaId: string; sharedHistory: boolean };
/** Meta's signup code: one token, no whitespace, a sane length. */
const SIGNUP_CODE = /^[A-Za-z0-9_\-#.]{10,4096}$/;
const META_ID = /^\d{6,20}$/;

/** What the browser hands back from Meta's Embedded Signup, checked before any Meta call is made with it. */
export function parseSignupInput(raw: unknown): ({ ok: true } & SignupInput) | { ok: false; error: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: "The signup answer is missing." };
  const code = typeof o.code === "string" ? o.code.trim() : "";
  if (!SIGNUP_CODE.test(code)) return { ok: false, error: "The signup code is missing or malformed." };
  const phoneNumberId = typeof o.phoneNumberId === "string" ? o.phoneNumberId.trim() : "";
  if (!META_ID.test(phoneNumberId)) return { ok: false, error: "The phone number id is missing - the signup did not finish." };
  const wabaId = typeof o.wabaId === "string" ? o.wabaId.trim() : "";
  if (!META_ID.test(wabaId)) return { ok: false, error: "The WhatsApp Business Account id is missing - the signup did not finish." };
  return { ok: true, code, phoneNumberId, wabaId, sharedHistory: o.sharedHistory === true };
}
