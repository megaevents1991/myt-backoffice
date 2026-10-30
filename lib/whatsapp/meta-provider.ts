/**
 * The Meta WhatsApp Cloud API provider (Graph v26.0) - the ONE place the Graph endpoints are spelled out, behind
 * the `WaProvider` interface every caller sends through (spec 2026-10-21 section 7: a BSP is a later file, never
 * a change to callers). No DB here: `createMetaProvider(fetch)` takes the fetch it calls, so
 * scripts/whatsapp-selftest.ts runs every call over a stub. The public functions that record rows and read the
 * company's credentials are lib/services/whatsapp-cloud.ts.
 *
 * Coexistence endpoints (Meta, "Onboard WhatsApp Business app users"): the six months of history are asked for
 * with POST /{phoneId}/smb_app_data { messaging_product: "whatsapp", sync_type: "history" } - within 24 h of the
 * signup, once; the app subscribes to the WABA's webhooks with POST /{wabaId}/subscribed_apps. The phone read asks
 * both `platform_type` and `is_on_biz_app` - either saying "WhatsApp Business app" means coexistence.
 */
import { WA_TEXT_MAX } from "@/lib/whatsapp/rules";
import type { WaTemplate } from "@/lib/services/whatsapp-db";

export const GRAPH_VERSION = "v26.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 15_000;
/** Pages of 100 templates followed through `paging.next` before the list is called whole. */
const TEMPLATE_PAGES_MAX = 10;
const TEMPLATE_PAGE = 100;

export interface Config {
  token: string;
  phoneId: string;
}

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };
export type TemplateArgs = { to: string; template: string; params: string[]; language: string };
export type MediaDownload = { bytes: Uint8Array; mime: string };
export type PhoneInfo = {
  displayPhone: string;
  verifiedName: string | null;
  qualityRating: string | null;
  platformType: string | null;
  isOnBizApp: boolean | null;
};
export type ExchangeResult = { token: string } | { error: string };
export type TemplateSummary = Omit<WaTemplate, "syncedAt">;

export interface WaProvider {
  sendTemplate(cfg: Config, args: TemplateArgs): Promise<SendResult>;
  sendText(cfg: Config, args: { to: string; text: string }): Promise<SendResult>;
  /** Meta's media: the id answers a short-lived url, the url answers the bytes (both with the bearer). Null when gone. */
  downloadMedia(token: string, mediaId: string): Promise<MediaDownload | null>;
  /** Every template of the WABA, every status; throws when Meta refuses. */
  listTemplates(token: string, wabaId: string): Promise<TemplateSummary[]>;
  /** Coexistence: ask Meta to replay the number's history through the `history` webhook field. */
  requestHistorySync(cfg: Config): Promise<SendResult>;
  /** Coexistence: ask Meta to send the number's phone book through the `smb_app_state_sync` webhook field. One shot, within 24 h. */
  requestContactsSync(cfg: Config): Promise<SendResult>;
  /** Our app receives the WABA's webhooks from now on. */
  subscribeApp(token: string, wabaId: string): Promise<SendResult>;
  phoneInfo(token: string, phoneId: string): Promise<PhoneInfo | null>;
  /** The ids of the WABA's phone numbers - a signup's phone id must be one of them; null when Meta refuses the read. */
  wabaPhoneNumbers(token: string, wabaId: string): Promise<string[] | null>;
  /** Embedded Signup's code for a business token (the token never leaves the caller's scope). */
  exchangeCode(args: { appId: string; appSecret: string; code: string }): Promise<ExchangeResult>;
}

// ---------------------------------------------------------------- pure helpers

type GraphError = { error?: { message?: string; code?: number; error_data?: { details?: string } } } | null | undefined;

/** Meta's error in a sentence staff can act on. */
export function explain(status: number, body: unknown): string {
  const err = (body as GraphError)?.error;
  const code = err?.code;
  if (code === 131026) return "WhatsApp could not deliver: this number has no WhatsApp account.";
  if (code === 132001) return "The message template is not approved yet (or its name / language differs) - check it in WhatsApp Manager.";
  if (code === 131042) return "The WhatsApp account has no payment method - add one in WhatsApp Manager.";
  if (code === 190 || status === 401) return "The WhatsApp token is invalid or expired - replace NEXT_SECRET_WHATSAPP_TOKEN.";
  if (code === 131047) return "More than 24 hours since the customer last wrote - only a template can be sent.";
  return `WhatsApp refused the message (${status}${code ? `, code ${code}` : ""}): ${err?.error_data?.details ?? err?.message ?? "no details"}`;
}

/** The `/messages` body of a template send; a template variable may never be empty, so a blank one goes as "-". */
export function templateBody(args: TemplateArgs) {
  return {
    messaging_product: "whatsapp",
    to: args.to,
    type: "template",
    template: {
      name: args.template,
      language: { code: args.language },
      components: args.params.length
        ? [{ type: "body", parameters: args.params.map((text) => ({ type: "text", text: text.trim() || "-" })) }]
        : [],
    },
  };
}

/** The `/messages` body of a free-text send, capped at Meta's limit. */
export function textBody(to: string, text: string) {
  return { messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, WA_TEXT_MAX), preview_url: false } };
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** The file extension a stored media gets from its mime ("audio/ogg; codecs=opus" -> ogg); unknown = bin. */
export function mediaExtension(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? "bin";
}

/**
 * What the bucket is told the file IS: the declared mime only when this build names it (EXTENSIONS), else
 * application/octet-stream - a sender's "text/html" or an SVG must never render from our storage (security review).
 */
export function safeContentType(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return base in EXTENSIONS ? base : "application/octet-stream";
}

/** Only a picture is shown inline on the card; everything else is served as a download. */
export const isInlineMedia = (mime: string): boolean => /^image\/(jpeg|png|webp|gif)$/.test(safeContentType(mime));

/** Where a media lands in the private bucket: <companyId>/<mediaId>.<ext> - the id is never a path. */
export function mediaStoragePath(companyId: string, mediaId: string, mime: string): string {
  return `${companyId}/${mediaId.replace(/[^A-Za-z0-9_-]/g, "_")}.${mediaExtension(mime)}`;
}

/**
 * Why a template may not be sent, or null: the cache (wa_templates, synced from Meta) knows the template in that
 * language and it is not APPROVED. A template the cache does not know - or an empty cache, never synced - is tried
 * and Meta's own answer (132001) explains a refusal.
 */
export function templateBlock(cache: readonly WaTemplate[], name: string, language: string): string | null {
  const known = cache.find((t) => t.name === name && t.language === language);
  if (!known || known.status === "APPROVED") return null;
  return `The template "${name}" (${language}) is ${known.status}, not approved - check it in WhatsApp Manager.`;
}

type Clock = { now(): number; sleep(ms: number): Promise<void> };
const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** At most `perSecond` sends a second per key (a company) inside one process - spec section 7. */
export class RateGate {
  private readonly stamps = new Map<string, number[]>();

  constructor(
    private readonly perSecond: number,
    private readonly clock: Clock = realClock,
  ) {}

  async take(key: string): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const recent = (this.stamps.get(key) ?? []).filter((t) => t > now - 1000);
      if (recent.length < this.perSecond) {
        recent.push(now);
        this.stamps.set(key, recent);
        return;
      }
      await this.clock.sleep(Math.max(1, recent[0] + 1000 - now));
    }
  }
}

// ---------------------------------------------------------------- the Graph calls

type GraphAnswer = { ok: boolean; status: number; json: unknown };

function failure(what: string, e: unknown): { ok: false; error: string } {
  const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
  console.error(`whatsapp-cloud: ${what} failed:`, e instanceof Error ? e.message : e);
  return { ok: false, error: timedOut ? "WhatsApp did not answer in time - try again." : "WhatsApp could not be reached - try again." };
}

const BODY_PARAM = /\{\{\d+\}\}/g;

export function createMetaProvider(fetchImpl: typeof fetch = fetch, opts: { timeoutMs?: number } = {}): WaProvider {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function graph(url: string, init: { method: "GET" | "POST"; token?: string; body?: unknown }): Promise<GraphAnswer> {
    const headers: Record<string, string> = {};
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  }

  async function post(cfg: Config, edge: string, body: unknown, what: string): Promise<SendResult> {
    try {
      const answer = await graph(`${GRAPH}/${cfg.phoneId}/${edge}`, { method: "POST", token: cfg.token, body });
      if (!answer.ok) return { ok: false, error: explain(answer.status, answer.json) };
      const json = answer.json as { messages?: { id?: string }[]; request_id?: string } | null;
      return { ok: true, messageId: json?.messages?.[0]?.id ?? json?.request_id ?? null };
    } catch (e) {
      return failure(what, e);
    }
  }

  return {
    sendTemplate: (cfg, args) => post(cfg, "messages", templateBody(args), "template send"),
    sendText: (cfg, args) => post(cfg, "messages", textBody(args.to, args.text), "text send"),

    async downloadMedia(token, mediaId) {
      try {
        const meta = await graph(`${GRAPH}/${encodeURIComponent(mediaId)}`, { method: "GET", token });
        const info = meta.json as { url?: string; mime_type?: string } | null;
        if (!meta.ok || !info?.url) {
          console.warn(`whatsapp-cloud: media ${mediaId} unavailable (${meta.status})`);
          return null;
        }
        const file = await fetchImpl(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
        if (!file.ok) {
          console.warn(`whatsapp-cloud: media ${mediaId} download answered ${file.status}`);
          return null;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { bytes, mime: info.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream" };
      } catch (e) {
        failure(`media ${mediaId} download`, e);
        return null;
      }
    },

    async listTemplates(token, wabaId) {
      const out: TemplateSummary[] = [];
      let url: string | null = `${GRAPH}/${wabaId}/message_templates?fields=name,language,category,status,components&limit=${TEMPLATE_PAGE}`;
      for (let page = 0; url && page < TEMPLATE_PAGES_MAX; page++) {
        const answer: GraphAnswer = await graph(url, { method: "GET", token });
        if (!answer.ok) throw new Error(explain(answer.status, answer.json));
        const json = answer.json as {
          data?: { name?: string; language?: string; category?: string | null; status?: string; components?: { type?: string; text?: string }[] }[];
          paging?: { next?: string };
        } | null;
        for (const t of json?.data ?? []) {
          if (!t.name || !t.language) continue;
          const body = t.components?.find((c) => c.type === "BODY")?.text ?? null;
          out.push({
            name: t.name,
            language: t.language,
            category: t.category ?? null,
            status: t.status ?? "UNKNOWN",
            body,
            paramCount: body ? new Set(body.match(BODY_PARAM) ?? []).size : 0,
          });
        }
        url = json?.paging?.next ?? null;
      }
      return out;
    },

    requestHistorySync: (cfg) => post(cfg, "smb_app_data", { messaging_product: "whatsapp", sync_type: "history" }, "history sync request"),

    requestContactsSync: (cfg) => post(cfg, "smb_app_data", { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" }, "contacts sync request"),

    async subscribeApp(token, wabaId) {
      try {
        const answer = await graph(`${GRAPH}/${wabaId}/subscribed_apps`, { method: "POST", token });
        if (!answer.ok) return { ok: false, error: explain(answer.status, answer.json) };
        return { ok: true, messageId: null };
      } catch (e) {
        return failure("webhook subscription", e);
      }
    },

    async phoneInfo(token, phoneId) {
      try {
        const answer = await graph(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,platform_type,is_on_biz_app`, { method: "GET", token });
        const json = answer.json as { display_phone_number?: string; verified_name?: string; quality_rating?: string; platform_type?: string; is_on_biz_app?: boolean } | null;
        if (!answer.ok || !json?.display_phone_number) {
          console.warn(`whatsapp-cloud: phone ${phoneId} read answered ${answer.status}`);
          return null;
        }
        return {
          displayPhone: json.display_phone_number,
          verifiedName: json.verified_name ?? null,
          qualityRating: json.quality_rating ?? null,
          platformType: json.platform_type ?? null,
          isOnBizApp: typeof json.is_on_biz_app === "boolean" ? json.is_on_biz_app : null,
        };
      } catch (e) {
        failure(`phone ${phoneId} read`, e);
        return null;
      }
    },

    async wabaPhoneNumbers(token, wabaId) {
      try {
        const answer = await graph(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`, { method: "GET", token });
        const json = answer.json as { data?: { id?: string }[] } | null;
        if (!answer.ok || !Array.isArray(json?.data)) {
          console.warn(`whatsapp-cloud: phone numbers of WABA ${wabaId} answered ${answer.status}`);
          return null;
        }
        return json.data.map((n) => n.id).filter((id): id is string => typeof id === "string");
      } catch (e) {
        failure(`phone numbers of WABA ${wabaId}`, e);
        return null;
      }
    },

    async exchangeCode({ appId, appSecret, code }) {
      try {
        const query = `client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
        const answer = await graph(`${GRAPH}/oauth/access_token?${query}`, { method: "GET" });
        const json = answer.json as { access_token?: string; error?: { message?: string } } | null;
        if (!answer.ok || !json?.access_token) {
          // the message names Meta's reason only - never the query, which carries the app secret
          return { error: `Facebook refused the signup code (${answer.status}): ${json?.error?.message ?? "no details"}` };
        }
        return { token: json.access_token };
      } catch (e) {
        return { error: failure("signup code exchange", e).error.replace("WhatsApp", "Facebook") };
      }
    },
  };
}

export const metaProvider: WaProvider = createMetaProvider();

/** The provider a `wa_accounts.provider` value names; null for one this build does not have. */
export const providerFor = (name: string): WaProvider | null => (name === "meta" ? metaProvider : null);
