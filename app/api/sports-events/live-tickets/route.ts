// app/api/sports-events/live-tickets/route.ts

import { NextRequest, NextResponse } from 'next/server';

/**
 * Live Tickets API endpoint
 * Fetches live ticket data from XS2Event for a specific event
 * 
 * Usage: GET /api/sports-events/live-tickets?event_id=xxx
 */

async function fetchXS2<T = unknown>(path: string): Promise<T> {
  const fetchOptions: RequestInit = {
    headers: { 
      'X-Api-Key': process.env.XS2EVENT_API_KEY!,
      'Content-Type': 'application/json'
    },
    cache: 'no-store'
  };

  try {
    const res = await fetch(`${process.env.XS2EVENT_API_URL}/${path}`, fetchOptions);
    
    if (!res.ok) {
      throw new Error(`XS2Event API error: ${res.status} ${res.statusText}`);
    }
    
    return await res.json();
  } catch (error) {
    console.error(`Failed to fetch from XS2Event API (${path}):`, error);
    throw error;
  }
}

async function fetchAllPaginated<T = unknown>(
  path: string, 
  maxPages: number = 10
): Promise<T[]> {
  const allData: T[] = [];
  let currentPage = 1;
  let hasMoreData = true;
  
  while (hasMoreData && currentPage <= maxPages) {
    try {
      const separator = path.includes('?') ? '&' : '?';
      const paginatedPath = `${path}${separator}page_size=100&page=${currentPage}`;
      
      const response = await fetchXS2<any>(paginatedPath);
      
      let pageData: T[] = [];
      let pagination: any = null;
      
      if (Array.isArray(response)) {
        pageData = response;
        hasMoreData = response.length === 100;
      } else if (typeof response === 'object' && response !== null) {
        pageData = response.tickets || response.data || response.results || [];
        pagination = response.pagination || response.meta;
        
        if (pagination) {
          hasMoreData = pagination.has_next || pagination.hasNext || false;
        } else {
          hasMoreData = pageData.length === 100;
        }
      }
      
      if (pageData.length === 0) {
        hasMoreData = false;
      } else {
        allData.push(...pageData);
      }
      
      currentPage++;
      
      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Error fetching page ${currentPage}:`, error);
      hasMoreData = false;
    }
  }
  
  return allData;
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

    console.log(`🎫 Fetching tickets for event: ${eventId}`);
    
    const tickets = await fetchAllPaginated(
      `tickets?event_id=${eventId}&ticket_status=available&stock=gt:0`
    );

    console.log(`🎫 Found ${tickets.length} tickets for event: ${eventId}`);

    return NextResponse.json({
      success: true,
      data: { tickets },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Live tickets API failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch live tickets',
        details: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
