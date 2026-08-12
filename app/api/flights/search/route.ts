import { NextRequest, NextResponse } from "next/server";
import { amadeus } from "../amadeusClient";

interface FlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  nonStop: boolean;
  currencyCode?: string;
}

const USA_AIRPORT_CODES = new Set([
  "ATL",
  "LAX",
  "ORD",
  "DFW",
  "DEN",
  "JFK",
  "SFO",
  "SEA",
  "LAS",
  "MCO",
  "EWR",
  "CLT",
  "PHX",
  "IAH",
  "MIA",
  "BOS",
  "MSP",
  "DTW",
  "FLL",
  "PHL",
  "LGA",
  "BWI",
  "SLC",
  "DCA",
  "SAN",
  "MDW",
  "HNL",
  "PDX",
  "DAL",
  "STL",
  "HOU",
  "MCI",
  "OAK",
  "SMF",
  "MSY",
  "RDU",
  "SJC",
  "AUS",
  "BNA",
  "IND",
  "JAX",
  "CMH",
  "RSW",
  "PIT",
  "MEM",
  "SAT",
  "OMA",
  "BUF",
  "CLE",
  "BDL",
  "ORF",
  "RIC",
  "TPA",
  "PBI",
  "ABQ",
  "OGG",
  "KOA",
  "LIH",
  "ITO",
  "GRR",
  "MKE",
  "TUL",
  "OKC",
  "BOI",
  "FAT",
  "SNA",
  "BUR",
  "ONT",
  "LGB",
  "SJU",
  "PWM",
  "ALB",
  "SYR",
  "ROC",
  "BTV",
  "MHT",
  "PVD",
  "BGR",
  "GSP",
  "CHS",
  "SAV",
  "PNS",
  "MOB",
  "HSV",
  "BHM",
  "MGM",
  "DSM",
  "MSN",
  "FSD",
  "RAP",
  "GFK",
  "BIS",
  "BTR",
  "SHV",
  "LIT",
  "XNA",
  "TYS",
  "CHA",
  "GSO",
  "AVL",
  "MYR",
  "CAE",
  "AGS",
  "VPS",
  "TLH",
  "GNV",
  "DAB",
  "MLB",
  "SRQ",
  "PIE",
  "ECP",
  "CID",
  "DBQ",
  "MLI",
  "PIA",
  "BMI",
  "SPI",
  "EVV",
  "SBN",
  "FWA",
  "TOL",
  "CAK",
  "YNG",
  "ERI",
  "AVP",
  "ABE",
  "MDT",
  "IPT",
  "ELM",
  "BGM",
  "ITH",
  "SWF",
  "HPN",
  "ISP",
  "ACY",
  "TTN",
  "PHF",
  "ILM",
  "FAY",
  "OAJ",
  "IAD",
]);

function isUSADestination(iataCode: string): boolean {
  return USA_AIRPORT_CODES.has(iataCode.toUpperCase());
}

function getStopsCount(offer: any): number {
  const itineraries = Array.isArray(offer?.itineraries)
    ? offer.itineraries
    : [];
  const maxStopsAcrossItineraries = itineraries.reduce(
    (maxStops: number, itinerary: any) => {
      const segments = Array.isArray(itinerary?.segments)
        ? itinerary.segments
        : [];
      const stops = Math.max(0, segments.length - 1);
      return Math.max(maxStops, stops);
    },
    0,
  );
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
        { status: 400 },
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

    // Amadeus per-request client reference (ama-Client-Ref) - required by the
    // production-certification checklist so Amadeus can trace each call.
    const clientRef = `MYT-BO-${originLocationCode}${destinationLocationCode}-${Math.floor(Date.now() / 1000)}`;

    // 1) Primary search: use requested nonStop behavior
    const primaryParams = {
      ...baseSearchParams,
      nonStop: Boolean(nonStop),
    };

    const primaryResponse = await amadeus.shopping.flightOffersSearch.get(
      primaryParams,
      clientRef,
    );
    let offers: any[] = Array.isArray(primaryResponse?.data)
      ? primaryResponse.data
      : [];

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

      const fallbackResponse = await amadeus.shopping.flightOffersSearch.get(
        fallbackParams,
        clientRef,
      );
      const fallbackOffers: any[] = Array.isArray(fallbackResponse?.data)
        ? fallbackResponse.data
        : [];
      const maxStopsAllowed = isUSADestination(destinationLocationCode) ? 2 : 1;
      offers = fallbackOffers.filter(
        (offer: any) => getStopsCount(offer) <= maxStopsAllowed,
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
      { status: 500 },
    );
  }
}
