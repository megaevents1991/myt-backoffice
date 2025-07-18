import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const checkin = searchParams.get('checkin');
    const checkout = searchParams.get('checkout');

    // Validate required parameters
    if (!lat || !lon || !checkin || !checkout) {
      return NextResponse.json(
        { error: "Missing required parameters: lat, lon, checkin, checkout" },
        { status: 400 }
      );
    }

    // Build the URL for the hotel service
    const hotelServiceUrl = process.env.NEXT_SECRET_HOTEL_SERVICE_URL || 'http://localhost:3000';
    const revalidationSecret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
    const proxyUrl = `${hotelServiceUrl}/api/hotels?lat=${lat}&lon=${lon}&checkin=${checkin}&checkout=${checkout}&secret=${revalidationSecret}`;

    // Make the request to your hotel service
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to search hotels');
    }

    // Return the data with CORS headers
    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error: any) {
    console.error('Hotel proxy error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to search hotels',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Handle preflight requests
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
