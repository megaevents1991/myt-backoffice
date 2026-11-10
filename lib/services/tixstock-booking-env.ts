// Which TixStock host and token a booking uses (backoffice). The environment itself is decided by the EVENT
// (lib/tixstock-booking/rules.ts `bookingEnvFor`), never here and never by a global switch.
//
//   sandbox    - NEXT_SECRET_TIXSTOCK_SANDBOX_URL + NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN (Dor pastes them).
//   production - closed until NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING is exactly "true", and then only with
//                NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN, the token TixStock issues after its health check.
//
// The feed's NEXT_SECRET_TIXSTOCK_API_URL / NEXT_SECRET_TIXSTOCK_TOKEN are never read here: the price sync and the
// site's ticket step keep them to themselves, and a booking must never go out on the feed's token.
// Test: scripts/tixstock-booking-client-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.10.
import { createTixstockClient, type TixstockClient } from "../tixstock-booking/client";
import type { BookingEnv } from "../tixstock-booking/rules";

export const TIXSTOCK_PRODUCTION_URL = "https://pf.tixstock.com/v1";

/** Reads `process.env` at call time. `fetchImpl` is for tests only. */
export function tixstockClientFor(
  env: BookingEnv,
  fetchImpl?: typeof fetch,
): { ok: true; client: TixstockClient } | { ok: false; kind: "not_configured" | "production_closed" } {
  if (env === "sandbox") {
    const baseUrl = process.env.NEXT_SECRET_TIXSTOCK_SANDBOX_URL?.trim();
    const token = process.env.NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN?.trim();
    // A test booking must never reach the production host, whatever was pasted into the sandbox variable.
    if (!baseUrl || !token || !/sandbox/i.test(baseUrl)) return { ok: false, kind: "not_configured" };
    return { ok: true, client: createTixstockClient({ baseUrl, token, fetchImpl }) };
  }

  if (process.env.NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING !== "true") return { ok: false, kind: "production_closed" };
  const token = process.env.NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN?.trim();
  if (!token) return { ok: false, kind: "not_configured" };
  return { ok: true, client: createTixstockClient({ baseUrl: TIXSTOCK_PRODUCTION_URL, token, fetchImpl }) };
}
