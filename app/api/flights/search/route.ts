import { NextRequest, NextResponse } from "next/server";

const Amadeus = require("amadeus");

const amadeus = new Amadeus({
  clientId: process.env.NEXT_SECRET_AMADEUS_CLIENT_ID as string,
  clientSecret: process.env.NEXT_SECRET_AMADEUS_CLIENT_SECRET as string,
  hostname: 'production',
});

interface FlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  nonStop: boolean;
  currencyCode?: string;
}

function getStopsCount(offer: any): number {
  const itineraries = Array.isArray(offer?.itineraries) ? offer.itineraries : [];
  const maxStopsAcrossItineraries = itineraries.reduce((maxStops: number, itinerary: any) => {
    const segments = Array.isArray(itinerary?.segments) ? itinerary.segments : [];
    const stops = Math.max(0, segments.length - 1);
    return Math.max(maxStops, stops);
  }, 0);
  return maxStopsAcrossItineraries;
}

function pickTargetPrice(offers: any[]): number | null {
  if (!offers || offers.length === 0) return null;
  const prices = offers
    .map((offer: any) => Number.parseFloat(offer?.price?.total))
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
        { status: 400 }
      );
    }

    // Prepare base search parameters
    const baseSearchParams: any = {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      adults: adults.toString(),
      currencyCode,
      max: 10, // Limit results for performance
    };

    if (returnDate) {
      baseSearchParams.returnDate = returnDate;
    }

    // 1) Primary search: use requested nonStop behavior
    const primaryParams = {
      ...baseSearchParams,
      nonStop: Boolean(nonStop),
    };

    const primaryResponse = await amadeus.shopping.flightOffersSearch.get(primaryParams);
    let offers: any[] = Array.isArray(primaryResponse?.data) ? primaryResponse.data : [];

    // 2) Fallback search: if nonStop was requested and none returned,
    //    retry allowing connections, then filter to at most 1 connection (<= 1 stop)
    let usedFallback = false;
    if (Boolean(nonStop) && offers.length === 0) {
      usedFallback = true;
      const fallbackParams = {
        ...baseSearchParams,
        nonStop: false,
        max: 50,
      };

      const fallbackResponse = await amadeus.shopping.flightOffersSearch.get(fallbackParams);
      const fallbackOffers: any[] = Array.isArray(fallbackResponse?.data) ? fallbackResponse.data : [];
      offers = fallbackOffers.filter((offer: any) => getStopsCount(offer) <= 1);
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
        maxConnections: usedFallback ? 1 : (Boolean(nonStop) ? 0 : undefined),
        rule: "third-cheapest-if-possible-else-most-expensive",
      },
      // Optionally include some flight data for debugging
      // offers: offers.slice(0, 3), // First 3 offers only
    });
  } catch (error: any) {
    console.error("Flight search error:", error);
    
    // Handle Amadeus-specific errors
    let errorMessage = "Failed to search flights";
    if (error.response?.data?.errors) {
      errorMessage = error.response.data.errors[0]?.detail || errorMessage;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      {
        error: "Failed to search flights",
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
