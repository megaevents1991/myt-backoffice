interface HotelSearchParams {
  lat: number;
  lon: number;
  checkin: string;
  checkout: string;
}

interface HotelDetails {
  hid: number;
  name: string;
  room_name: string;
  meal: string;
}

interface HotelSearchResult {
  success: boolean;
  cheapestPrice: number | null;
  currency: string;
  totalOffers: number;
  hotelDetails?: HotelDetails;
  error?: string;
  message?: string;
}

export async function searchHotelPrices(
  params: HotelSearchParams
): Promise<HotelSearchResult> {
  try {
    const searchParams = new URLSearchParams({
      lat: params.lat.toString(),
      lon: params.lon.toString(),
      checkin: params.checkin,
      checkout: params.checkout,
    });

    const response = await fetch(`/api/hotels/search?${searchParams}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to search hotels");
    }

    // Handle the actual API response format
    return {
      success: true,
      cheapestPrice: data.cheapest_price || null,
      currency: data.currency || "USD",
      totalOffers: data.total_4star_hotels_found || 0,
      hotelDetails: data.hotel ? {
        hid: data.hotel.hid,
        name: data.hotel.name,
        room_name: data.hotel.room_name,
        meal: data.hotel.meal,
      } : undefined,
    };
  } catch (error) {
    console.error("Hotel search action error:", error);
    return {
      success: false,
      cheapestPrice: null,
      currency: "USD",
      totalOffers: 0,
      error: "Failed to search hotels",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
