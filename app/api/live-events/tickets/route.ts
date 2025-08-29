// app/api/live-events/tickets/route.ts

import { NextRequest, NextResponse } from 'next/server';

/**
 * Live Tickets API endpoint for LIVE events
 * Fetches real-time ticket data from LIVE API for a specific event
 * 
 * Usage: GET /api/live-events/tickets?event_id=xxx
 */

async function fetchLiveAPI<T = unknown>(endpoint: string): Promise<T> {
  const LIVE_API_KEY = process.env.NEXT_SECRET_LIVE_API_KEY;
  const LIVE_API_BASE_URL = process.env.NEXT_SECRET_LIVE_API_URL || "https://api.doctorticket.com/api";

  if (!LIVE_API_KEY) {
    throw new Error('LIVE_API_KEY environment variable is not set');
  }

  const fetchOptions: RequestInit = {
    headers: { 
      'Authorization': LIVE_API_KEY,
      'Content-Type': 'application/json'
    },
    cache: 'no-store'
  };

  try {
    const url = `${LIVE_API_BASE_URL}/${endpoint}`;
    const res = await fetch(url, fetchOptions);
    
    if (!res.ok) {
      throw new Error(`LIVE API error: ${res.status} ${res.statusText}`);
    }
    
    return await res.json();
  } catch (error) {
    console.error(`Failed to fetch from LIVE API (${endpoint}):`, error);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');

    if (!eventId) {
      return NextResponse.json({
        success: false,
        error: 'event_id parameter is required'
      }, { status: 400 });
    }

    console.log(`🎫 Fetching LIVE tickets for event: ${eventId}`);
    
    // Fetch event details including ticket categories
    const eventData = await fetchLiveAPI(`Events/getOneEvent?eid=${eventId}`);

    if (!Array.isArray(eventData) || eventData.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Event not found'
      }, { status: 404 });
    }

    const event = eventData[0];
    const tickets = event.ticketCategory || [];

    console.log(`🎫 Found ${tickets.length} ticket categories for event: ${eventId}`);

    return NextResponse.json({
      success: true,
      data: { 
        tickets,
        event: {
          id: event.id,
          name: event.eventName,
          showDate: event.showDate,
          currency: event.currency,
          venue: event.venue,
          performers: event.performers
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ LIVE tickets API failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch LIVE tickets',
        details: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
