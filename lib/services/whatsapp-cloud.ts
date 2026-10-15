/**
 * WhatsApp Cloud API (Meta's official business API) - sending from a company's OWN number, the
 * way Alon asked for on 15.10 ("the system sends the customer the message from the WhatsApp it is
 * connected to"). Off until configured: with no token or no phone-number id for the company every
 * caller falls back to opening the rep's own WhatsApp (whatsapp:// / wa.me).
 *
 * Env (server only, never typed by Claude - Dor sets them in Vercel):
 *   NEXT_SECRET_WHATSAPP_TOKEN              permanent system-user token with whatsapp_business_messaging
 *   NEXT_SECRET_WHATSAPP_PHONE_ID_<SLUG>    the company's phone-number id, slug upper-cased with
 *                                           non-alphanumerics as "_" (megafamily -> ..._MEGAFAMILY)
 *   NEXT_SECRET_WHATSAPP_LINK_TEMPLATE      approved template for the booking link (default "booking_link"),
 *                                           Hebrew, body with three variables: {{1}} first name,
 *                                           {{2}} tour, {{3}} the link
 *
 * A business may write first only with an approved TEMPLATE (free text works only inside the 24 h
 * after the customer wrote), so the booking link goes out as one. Server only.
 */
import type { Company } from "@/lib/company";

const GRAPH = "https://graph.facebook.com/v26.0";
const TIMEOUT_MS = 15_000;
const DEFAULT_LINK_TEMPLATE = "booking_link";

const envKey = (slug: string): string => `NEXT_SECRET_WHATSAPP_PHONE_ID_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

interface Config {
  token: string;
  phoneId: string;
}

function configOf(company: Company): Config | null {
  const token = process.env.NEXT_SECRET_WHATSAPP_TOKEN?.trim();
  const phoneId = process.env[envKey(company.slug)]?.trim();
  if (!token || !phoneId || !/^\d{6,20}$/.test(phoneId)) return null;
  return { token, phoneId };
}

/** The company can send from its own number. */
export const whatsappApiReady = (company: Company): boolean => configOf(company) !== null;

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };

/** Meta's error in a sentence staff can act on. */
function explain(status: number, body: unknown): string {
  const err = (body as { error?: { message?: string; code?: number; error_data?: { details?: string } } } | null)?.error;
  const code = err?.code;
  if (code === 131026) return "WhatsApp could not deliver: this number has no WhatsApp account.";
  if (code === 132001) return "The message template is not approved yet (or its name / language differs) - check it in WhatsApp Manager.";
  if (code === 190 || status === 401) return "The WhatsApp token is invalid or expired - replace NEXT_SECRET_WHATSAPP_TOKEN.";
  if (code === 131047) return "More than 24 hours since the customer last wrote - only a template can be sent.";
  return `WhatsApp refused the message (${status}${code ? `, code ${code}` : ""}): ${err?.error_data?.details ?? err?.message ?? "no details"}`;
}

/** Sends one approved template to an international number (digits only, e.g. 972528968912). */
export async function sendTemplate(
  company: Company,
  args: { to: string; template?: string; params: string[]; language?: string },
): Promise<SendResult> {
  const config = configOf(company);
  if (!config) return { ok: false, error: "The company's WhatsApp number is not connected yet." };
  if (!/^\d{11,15}$/.test(args.to)) return { ok: false, error: "The customer's phone is not a valid international number." };
  const template = args.template ?? process.env.NEXT_SECRET_WHATSAPP_LINK_TEMPLATE?.trim() ?? DEFAULT_LINK_TEMPLATE;
  try {
    const response = await fetch(`${GRAPH}/${config.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: args.to,
        type: "template",
        template: {
          name: template,
          language: { code: args.language ?? "he" },
          components: [
            {
              type: "body",
              // a template variable may never be empty
              parameters: args.params.map((text) => ({ type: "text", text: text.trim() || "-" })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: explain(response.status, body) };
    const messageId = (body as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id ?? null;
    return { ok: true, messageId };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error("whatsapp-cloud: send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: timedOut ? "WhatsApp did not answer in time - try again." : "WhatsApp could not be reached - try again." };
  }
}
