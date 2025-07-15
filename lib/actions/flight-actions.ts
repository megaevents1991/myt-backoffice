interface FlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  currencyCode?: string;
}

interface FlightSearchResult {
  success: boolean;
  cheapestPrice: number | null;
  currency: string;
  totalOffers: number;
  error?: string;
  message?: string;
}

export async function searchFlightPrices(
  params: FlightSearchParams
): Promise<FlightSearchResult> {
  try {
    const response = await fetch("/api/flights/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to search flights");
    }

    return data;
  } catch (error) {
    console.error("Flight search action error:", error);
    return {
      success: false,
      cheapestPrice: null,
      currency: params.currencyCode || "USD",
      totalOffers: 0,
      error: "Failed to search flights",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Helper function to get the origin airport code (could be from user's location or a default)
export function getOriginAirportCode(): string {
  // Check for environment variable first
  const defaultOrigin = process.env.NEXT_PUBLIC_DEFAULT_ORIGIN_AIRPORT;
  if (defaultOrigin && isValidIATACode(defaultOrigin)) {
    return defaultOrigin;
  }
  return "TLV";
}

// Helper function to validate IATA codes
export function isValidIATACode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}
