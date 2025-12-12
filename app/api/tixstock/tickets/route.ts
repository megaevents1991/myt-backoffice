import { NextRequest, NextResponse } from 'next/server';

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL || 'https://sandbox-pf.tixstock.com/v1';
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');

    if (!eventId) {
      return NextResponse.json({ success: false, error: 'Missing event_id' }, { status: 400 });
    }

    if (!TIXSTOCK_TOKEN) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const url = `${TIXSTOCK_API_URL}/tickets/feed?event_id=${eventId}`;
    console.log(`Fetching TixStock tickets for event ${eventId}...`);

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TIXSTOCK_TOKEN}`,
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });

    if (!res.ok) {
      throw new Error(`TixStock API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    console.log('TixStock tickets response:', JSON.stringify(data, null, 2));

    return NextResponse.json({
      success: true,
      data: data
    });

  } catch (error: any) {
    console.error('TixStock tickets fetch failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
