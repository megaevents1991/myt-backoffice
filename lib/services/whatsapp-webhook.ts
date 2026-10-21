/**
 * Meta's webhook, with its env and its deps injected (selftest scripts/whatsapp-webhook-selftest.ts).
 *
 * GET is the one-time handshake: Meta sends hub.mode=subscribe, hub.verify_token and hub.challenge, and we echo the
 * challenge only when the token is ours (NEXT_SECRET_WHATSAPP_VERIFY_TOKEN). POST is a batch: the RAW body is
 * checked against X-Hub-Signature-256 (HMAC-SHA256 with the app secret, timing-safe) BEFORE it is parsed - a bad
 * or missing signature is 401, a missing secret refuses everything with one error line; a signed body that is not
 * JSON is Meta's own and answers 200 with a warning; every event then goes through handleWebhookEvents, which
 * never throws past itself. The answer is 200 whatever happened inside: Meta re-delivers a non-2xx for hours and
 * would only replay the same failure. middleware.ts skips /api, so the signature IS the guard - there is no session.
 * The route file (app/api/whatsapp/webhook/route.ts) is a thin wrapper over the two functions.
 */
import { timingSafeEqual } from "node:crypto";
import { parseWebhook, verifySignature } from "@/lib/whatsapp/rules";
import { handleWebhookEvents, type InboundDeps } from "@/lib/services/whatsapp-inbound";

export type WebhookEnv = { appSecret: string | null; verifyToken: string | null };
export type WebhookAnswer = { status: number; body: Record<string, unknown> };

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export const envFromProcess = (): WebhookEnv => ({
  appSecret: clean(process.env.NEXT_SECRET_WHATSAPP_APP_SECRET),
  verifyToken: clean(process.env.NEXT_SECRET_WHATSAPP_VERIFY_TOKEN),
});

const sameSecret = (given: string, ours: string): boolean => {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(ours, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};

const FORBIDDEN = { status: 403, text: "forbidden" } as const;
const UNAUTHORIZED: WebhookAnswer = { status: 401, body: { ok: false, error: "unauthorized" } };

/** Meta's subscription handshake: the challenge back, only for our verify token. */
export function handleVerify(url: URL, env: WebhookEnv): { status: number; text: string } {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !env.verifyToken || !token || !challenge) return FORBIDDEN;
  if (!sameSecret(token, env.verifyToken)) return FORBIDDEN;
  return { status: 200, text: challenge };
}

/** One signed batch: 401 when the signature is not Meta's, else 200 with the counts, whatever happened inside. */
export async function handleWebhookPost(rawBody: string, signature: string | null, env: WebhookEnv, deps: InboundDeps): Promise<WebhookAnswer> {
  if (!env.appSecret) {
    deps.log.error("NEXT_SECRET_WHATSAPP_APP_SECRET is not set - every webhook is refused");
    return UNAUTHORIZED;
  }
  if (!verifySignature(rawBody, signature, env.appSecret)) return UNAUTHORIZED;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    deps.log.warn(`signed body is not JSON (${rawBody.length} bytes) - ignored`);
    return { status: 200, body: { ok: true, events: 0, stored: 0, skipped: 0, inquiries: 0, optOuts: 0, statuses: 0, errors: 0 } };
  }
  const events = parseWebhook(payload);
  const summary = await handleWebhookEvents(events, deps);
  (deps.log.info ?? deps.log.warn)(`[whatsapp] events=${events.length} stored=${summary.stored} inquiries=${summary.inquiries} errors=${summary.errors.length}`);
  return {
    status: 200,
    body: {
      ok: true,
      events: events.length,
      stored: summary.stored,
      skipped: summary.skipped,
      inquiries: summary.inquiries,
      optOuts: summary.optOuts,
      statuses: summary.statuses,
      errors: summary.errors.length,
    },
  };
}
