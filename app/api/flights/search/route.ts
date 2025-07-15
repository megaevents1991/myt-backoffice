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

    // Prepare search parameters
    const searchParams: any = {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      adults: adults.toString(),
      nonStop: true,
      currencyCode,
      max: 10, // Limit results for performance
    };

    if (returnDate) {
      searchParams.returnDate = returnDate;
    }

    // Search flights using Amadeus SDK
    const response = await amadeus.shopping.flightOffersSearch.get(searchParams);
    
    // Extract flight data
    const flightData = response.data;
    
    // Find the target price based on number of offers
    let cheapestPrice = null;
    let actualCurrency = currencyCode;
    if (flightData && flightData.length > 0) {
      const prices = flightData.map((offer: any) => parseFloat(offer.price.total));
      const sortedPrices = prices.sort((a: number, b: number) => a - b);
      
      if (sortedPrices.length > 3) {
        // Take the third-cheapest (index 2)
        cheapestPrice = sortedPrices[2];
      } else {
        // Take the most expensive
        cheapestPrice = Math.max(...prices);
      }
      
      // Use the currency from the first offer
      actualCurrency = flightData[0].price.currency;
    }

    return NextResponse.json({
      success: true,
      cheapestPrice,
      currency: actualCurrency,
      totalOffers: flightData?.length || 0,
      // Optionally include some flight data for debugging
      // flightData: flightData.slice(0, 3), // First 3 offers only
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
