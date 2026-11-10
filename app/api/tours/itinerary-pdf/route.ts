/**
 * POST /api/tours/itinerary-pdf { departureId, rooms } -> { url } | { error }
 *
 * The booking-link builder asks for the date's itinerary PDF as soon as the rep picks the date (Alon 10.11), so the
 * offer finds it ready. A route, not a server action: a tab runs its actions one at a time, and a 10-20 s print would
 * hold the builder's room quotes behind it. Staff and sales agents of a tours company only - middleware skips /api,
 * so the guard is the first thing here. The print itself is lib/services/tours-itinerary-pdf.ts.
 */
import { NextResponse } from "next/server";
import { requireCompanyRep } from "@/lib/company";
import { ensureItineraryPdf, itineraryDateOf } from "@/lib/services/tours-itinerary-pdf";
import { cleanRoomKeys } from "@/lib/tours/cases";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A person asks at most this many PDFs in RATE_WINDOW_MS - every new choice of rooms is a Chromium run and a file in
 * the public bucket (review 10.11). The builder asks once per pause of the rep; in memory per server instance, a speed bump.
 */
const RATE_MAX = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const asked = new Map<string, number[]>();
function overLimit(userId: string, now: number): boolean {
  const recent = (asked.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    asked.set(userId, recent);
    return true;
  }
  recent.push(now);
  asked.set(userId, recent);
  return false;
}

export async function POST(request: Request) {
  let company;
  let userId: string;
  try {
    const guard = await requireCompanyRep("tours");
    company = guard.company;
    userId = guard.session.sub;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = ((await request.json().catch(() => null)) ?? {}) as { departureId?: unknown; rooms?: unknown };
    const departureId = typeof body.departureId === "string" ? body.departureId : "";
    if (!UUID.test(departureId)) return NextResponse.json({ error: "Choose a departure." }, { status: 400 });
    if (overLimit(userId, Date.now())) return NextResponse.json({ error: "Too many itinerary PDFs in a few minutes - try again soon." }, { status: 429 });
    const date = await itineraryDateOf(company, departureId);
    if (!date) return NextResponse.json({ error: "This date is not on the site." }, { status: 404 });
    // the sheet prints the rooms the site pre-fills: the kinds this date prices, as many as a link holds - as prepareOffer
    const rooms = cleanRoomKeys(Array.isArray(body.rooms) ? body.rooms.filter((r): r is string => typeof r === "string") : [], date.rooms ?? []);
    if (rooms.length === 0) return NextResponse.json({ error: "Choose rooms this date sells." }, { status: 400 });
    const pdf = await ensureItineraryPdf(company, date, rooms);
    return pdf.ok ? NextResponse.json({ url: pdf.url }) : NextResponse.json({ error: pdf.error }, { status: 502 });
  } catch (e) {
    console.error("itinerary-pdf route:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The itinerary PDF could not be made." }, { status: 500 });
  }
}
