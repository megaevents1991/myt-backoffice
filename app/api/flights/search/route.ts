import { NextRequest, NextResponse } from "next/server";
import {
  fetchFlightOffers,
  getStopsCount,
  isUSADestination,
  type AmadeusOffer,
} from "@/lib/services/flight-search";

interface FlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  nonStop: boolean;
  currencyCode?: string;
}

// Legacy button rule: third-cheapest as a safety buffer. The new price-quote
// path (lib/services/price-quote.ts) uses the true cheapest + margin instead.
function pickTargetPrice(offers: AmadeusOffer[]): number | null {
  if (!offers || offers.length === 0) return null;
  const prices = offers
    .map((offer) => Number.parseFloat(offer?.price?.total ?? ""))
    .filter((n: number) => Number.isFinite(n));

  if (prices.length === 0) return null;
  prices.sort((a: number, b: number) => a - b);

  if (prices.length >= 3) return prices[2];
  return prices[prices.length - 1];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      returnDate,
      nonStop = true,
      adults = 1,
      currencyCode = "USD",
    }: FlightSearchParams = body;

    // Validate required parameters
    if (!originLocationCode || !destinationLocationCode || !departureDate) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 },
      );
    }

    // 1) Primary search: use requested nonStop behavior
    let offers = await fetchFlightOffers({
      originLocationCode,
      destinationLocationCode,
      departureDate,
      returnDate,
      adults,
      currencyCode,
      nonStop: Boolean(nonStop),
    });

    // 2) Fallback search: if nonStop was requested and none returned,
    //    retry allowing connections, then filter to at most 1 connection
    //    (<= 2 for USA destinations)
    let usedFallback = false;
    if (Boolean(nonStop) && offers.length === 0) {
      usedFallback = true;
      const fallbackOffers = await fetchFlightOffers({
        originLocationCode,
        destinationLocationCode,
        departureDate,
        returnDate,
        adults,
        currencyCode,
        nonStop: false,
        max: 50,
      });
      const maxStopsAllowed = isUSADestination(destinationLocationCode) ? 2 : 1;
      offers = fallbackOffers.filter(
        (offer) => getStopsCount(offer) <= maxStopsAllowed,
      );
    }

    const cheapestPrice = pickTargetPrice(offers);
    const actualCurrency = offers?.[0]?.price?.currency || currencyCode;
    const totalOffers = offers?.length || 0;

    return NextResponse.json({
      success: true,
      cheapestPrice,
      currency: actualCurrency,
      totalOffers,
      usedFallback,
      selection: {
        nonStopRequested: Boolean(nonStop),
        maxConnections: usedFallback ? 1 : Boolean(nonStop) ? 0 : undefined,
        rule: "third-cheapest-if-possible-else-most-expensive",
      },
    });
  } catch (error) {
    console.error("Flight search error:", error);

    // Handle Amadeus-specific errors
    let errorMessage = "Failed to search flights";
    const amadeusError = error as {
      response?: { data?: { errors?: { detail?: string }[] } };
      message?: string;
    };
    if (amadeusError.response?.data?.errors) {
      errorMessage = amadeusError.response.data.errors[0]?.detail || errorMessage;
    } else if (amadeusError.message) {
      errorMessage = amadeusError.message;
    }

    return NextResponse.json(
      {
        error: "Failed to search flights",
        message: errorMessage,
      },
      { status: 500 },
    );
  }
}
