/**
 * TixStock's webhook - one URL per environment: /api/tixstock/webhook/sandbox and /api/tixstock/webhook/production
 * (registered in TixStock's Reseller Admin). Fulfilment events carry the tickets (a base64 PDF, a mobile link, a
 * proof of transfer); order.update asks for our status.
 * middleware.ts skips /api, so the signature check inside handleTixstockWebhook IS the guard - there is no session
 * here. The key of the signature is that environment's API token (TixStock, 10.11.2026); with no token configured
 * every webhook is refused with 401.
 * The logic lives in lib/services/tixstock-webhook.ts (selftest scripts/tixstock-webhook-selftest.ts); this file
 * only reads the request and writes the answer. `maxDuration` is set in vercel.json too.
 */
import { NextResponse } from "next/server";
import { handleTixstockWebhook } from "@/lib/services/tixstock-webhook";
import { realWebhookDeps } from "@/lib/services/tixstock-booking-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ env: string }> }): Promise<Response> {
  const { env } = await context.params;
  if (env !== "sandbox" && env !== "production") return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    // The raw text, before any parse: the signature is over these exact bytes.
    const rawBody = await request.text();
    const apiToken =
      env === "sandbox" ? process.env.NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN : process.env.NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN;
    const answer = await handleTixstockWebhook(
      { env, rawBody, signature: request.headers.get("x-tixstock-signature"), apiToken: apiToken?.trim() || undefined },
      realWebhookDeps(),
    );
    return NextResponse.json(answer.body, { status: answer.status });
  } catch (e) {
    // A crash outside the handler's own guards. The refresh and the sweep can still bring the files.
    console.error("[tixstock-webhook] route failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ external_id: null, order_status: null, message: "internal", success: false }, { status: 500 });
  }
}
