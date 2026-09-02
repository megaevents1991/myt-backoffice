// Amadeus flight search, extracted from app/api/flights/search/route.ts so the
// nightly base-price sync and the price-quote service can search server-side
// without going through their own HTTP route. The route now imports from here;
// its response behavior (third-cheapest pick, fallback rules) is unchanged.
import { amadeus } from "@/app/api/flights/amadeusClient";

/** The subset of an Amadeus flight offer this codebase reads. */
export interface AmadeusOffer {
  price?: { total?: string; currency?: string };
  itineraries?: { segments?: unknown[] }[];
}

export interface FlightOffersQuery {
  /** Defaults to TLV - every package departs from Israel. */
  originLocationCode?: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  currencyCode?: string;
  nonStop: boolean;
  max?: number;
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

export function isUSADestination(iataCode: string): boolean {
  return USA_AIRPORT_CODES.has(iataCode.toUpperCase());
}

export function getStopsCount(offer: AmadeusOffer): number {
  const itineraries = Array.isArray(offer?.itineraries) ? offer.itineraries : [];
  return itineraries.reduce((maxStops: number, itinerary) => {
    const segments = Array.isArray(itinerary?.segments) ? itinerary.segments : [];
    return Math.max(maxStops, Math.max(0, segments.length - 1));
  }, 0);
}

/**
 * One raw Amadeus flight-offers call (with the certification client-ref).
 * Throws on API error - callers decide whether that is fatal.
 */
export async function fetchFlightOffers(query: FlightOffersQuery): Promise<AmadeusOffer[]> {
  const {
    originLocationCode = "TLV",
    destinationLocationCode,
    departureDate,
    returnDate,
    adults = 1,
    currencyCode = "USD",
    nonStop,
    max = 10,
  } = query;

  const params: Record<string, string | number | boolean> = {
    originLocationCode,
    destinationLocationCode,
    departureDate,
    adults: adults.toString(),
    currencyCode,
    max,
    nonStop,
  };
  if (returnDate) params.returnDate = returnDate;

  // Amadeus per-request client reference (ama-Client-Ref) - required by the
  // production-certification checklist so Amadeus can trace each call.
  const clientRef = `MYT-BO-${originLocationCode}${destinationLocationCode}-${Math.floor(Date.now() / 1000)}`;

  const response = await amadeus.shopping.flightOffersSearch.get(params, clientRef);
  return Array.isArray(response?.data) ? (response.data as AmadeusOffer[]) : [];
}

/**
 * Cheapest single offer for the query, USD, TLV origin. `nonStop: false` keeps
 * the product rule from the route's fallback: at most 1 connection (2 to the
 * USA). Returns null when nothing was found or the API failed (logged) -
 * never 0.
 */
export async function searchCheapestOffer(q: {
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  nonStop: boolean;
}): Promise<number | null> {
  try {
    const offers = await fetchFlightOffers({ ...q, max: q.nonStop ? 10 : 50 });
    const maxStops = q.nonStop ? 0 : isUSADestination(q.destinationLocationCode) ? 2 : 1;
    const usable = q.nonStop
      ? offers
      : offers.filter((offer) => getStopsCount(offer) <= maxStops);
    const prices = usable
      .map((offer) => Number.parseFloat(offer?.price?.total ?? ""))
      .filter((price) => Number.isFinite(price));
    return prices.length ? Math.min(...prices) : null;
  } catch (error) {
    console.error("flight-search: searchCheapestOffer failed", JSON.stringify(error));
    return null;
  }
}
