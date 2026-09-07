import { NextRequest, NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import {
  describeQuote,
  quoteFlight,
  quoteHotel,
  type QuoteResult,
} from "@/lib/services/price-quote";

/** The quote plus its one-line arithmetic, for toasts (client can't import the service). */
const withDetail = (quote: QuoteResult) =>
  quote ? { ...quote, detail: describeQuote(quote) } : null;

/**
 * Staff-only quote endpoint for the dashboard: the event form's search
 * buttons and the wizard's auto-fill call this instead of computing prices
 * client-side, so every surface shows the exact number the nightly sync
 * would write (Dor's rule: direct+$100 / connection when the gap > $300;
 * cheapest 3-star hotel +$120; rounded to tens).
 */
export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  try {
    const body = await request.json();
    if (body?.kind === "flight") {
      const { cityIata, departDate, returnDate } = body;
      if (!cityIata || !departDate || !returnDate) {
        return NextResponse.json(
          { success: false, message: "Missing flight params" },
          { status: 400 },
        );
      }
      const quote = await quoteFlight(cityIata, departDate, returnDate);
      return NextResponse.json({ success: true, quote: withDetail(quote) });
    }
    if (body?.kind === "hotel") {
      const { lat, lon, checkin, checkout } = body;
      if (typeof lat !== "number" || typeof lon !== "number" || !checkin || !checkout) {
        return NextResponse.json(
          { success: false, message: "Missing hotel params" },
          { status: 400 },
        );
      }
      const quote = await quoteHotel(lat, lon, checkin, checkout);
      return NextResponse.json({ success: true, quote: withDetail(quote) });
    }
    return NextResponse.json(
      { success: false, message: "Unknown kind" },
      { status: 400 },
    );
  } catch (error) {
    console.error("price-quote route failed", JSON.stringify(error));
    return NextResponse.json(
      { success: false, message: "Quote failed" },
      { status: 500 },
    );
  }
}
