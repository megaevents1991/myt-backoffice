/**
 * Meta's WhatsApp webhook - GET is the one-time subscription handshake, POST is every event batch of the subscribed
 * WABAs (messages, statuses, echoes from the WhatsApp Business app, history, template reviews, account updates).
 * middleware.ts skips /api, so the signature check inside handleWebhookPost IS the guard - there is no session here.
 * The logic lives in lib/services/whatsapp-webhook.ts (selftest scripts/whatsapp-webhook-selftest.ts); this file
 * only reads the request and writes the answer. `maxDuration` is set in vercel.json too.
 */
import { NextResponse } from "next/server";
import { envFromProcess, handleVerify, handleWebhookPost } from "@/lib/services/whatsapp-webhook";
import { realInboundDeps } from "@/lib/services/whatsapp-inbound-deps";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const answer = handleVerify(new URL(request.url), envFromProcess());
  return new Response(answer.text, { status: answer.status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    const answer = await handleWebhookPost(raw, request.headers.get("x-hub-signature-256"), envFromProcess(), realInboundDeps());
    return NextResponse.json(answer.body, { status: answer.status });
  } catch (e) {
    // a crash outside the handler's own guards: 500, so Meta re-delivers the batch later
    console.error("[whatsapp] webhook failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
