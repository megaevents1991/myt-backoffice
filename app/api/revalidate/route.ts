import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Get the domain and secret from environment variables
    const hotelServiceUrl = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
    const revalidationSecret = process.env.NEXT_SECRET_REVALIDATION_SECRET;

    if (!hotelServiceUrl || !revalidationSecret) {
      return NextResponse.json(
        { 
          error: "Missing required environment variables: NEXT_SECRET_HOTEL_SERVICE_URL or NEXT_SECRET_REVALIDATION_SECRET" 
        },
        { status: 500 }
      );
    }

    // Build the revalidation URL
    const revalidationUrl = `${hotelServiceUrl}/api/revalidate?secret=${revalidationSecret}`;

    // Make the request to trigger revalidation
    const response = await fetch(revalidationUrl, {});

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Revalidation failed: ${response.status} ${errorText}`);
    }

    let data;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json({
      success: true,
      message: "Pages revalidated successfully",
      data
    });

  } catch (error: any) {
    console.error('Revalidation error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to revalidate pages"
      },
      { status: 500 }
    );
  }
}
