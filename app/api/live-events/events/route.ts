import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';
import { LiveEventDB } from '@/types/live-events.types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('type'); // sports_live_event_dynamic / music_live_event_dynamic
    const category = searchParams.get('category'); // This is category1 name (e.g., "CONCERTS")
    const performer = searchParams.get('performer');
    const eventId = searchParams.get('event_id');
    const upcomingOnly = searchParams.get('upcoming') !== 'false';

    let query = supabase
      .from('live_events')
      .select(`*`, { count: 'exact' }) // Get exact count
      .eq('is_active', true)
      .order('show_date', { ascending: true });

    if (upcomingOnly) {
      query = query.gte('show_date', new Date().toISOString());
    }
    if (eventType && eventType !== 'all') {
      query = query.eq('event_type', eventType);
    }
    if (eventId) {
      query = query.eq('event_id', eventId);
    }

    // Try to get ALL data by fetching in chunks if needed
    let allData: LiveEventDB[] = [];
    let from = 0;
    const chunkSize = 1000; // Supabase's safe limit
    let hasMore = true;

    console.log('Starting to fetch all events...');

    while (hasMore) {
      const { data: chunkData, error } = await query
        .range(from, from + chunkSize - 1);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (chunkData) {
        allData.push(...(chunkData as unknown as LiveEventDB[]));
        console.log(`Fetched chunk: ${from} to ${from + chunkData.length - 1}, total so far: ${allData.length}`);
      }

      // Check if we've got all data
      hasMore = chunkData && chunkData.length === chunkSize;
      from += chunkSize;

      // Safety break to avoid infinite loops
      if (from > 20000) {
        console.warn('Safety break: fetched 20k+ events');
        break;
      }
    }

    console.log(`Total events fetched: ${allData.length}`);

    let filteredData: LiveEventDB[] = allData;

    // Filter by categories.category1 with proper typing
    if (category) {
      console.log(`Filtering by category: ${category}`);
      filteredData = allData.filter((event: LiveEventDB) => {
        // Now TypeScript knows the structure of categories
        if (event.categories && 
            event.categories.category1 && 
            Array.isArray(event.categories.category1)) {
          const categoryName = event.categories.category1[0]?.name;
          return categoryName === category;
        }
        return false;
      });
      console.log(`Found ${filteredData.length} events matching category ${category}`);
    }

    // Filter by performer with proper typing
    if (performer) {
      console.log(`Filtering by performer: ${performer}`);
      filteredData = filteredData.filter((event: LiveEventDB) => {
        if (event.performers && Array.isArray(event.performers)) {
          return event.performers.some(p => p.name === performer);
        }
        return false;
      });
      console.log(`Found ${filteredData.length} events matching performer ${performer}`);
    }

    return NextResponse.json({ 
      success: true, 
      data: filteredData, 
      timestamp: new Date().toISOString(),
      debug: {
        totalEvents: allData.length,
        filteredEvents: filteredData.length,
        category,
        performer
      }
    }, { 
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { 
      status: 500,
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  }
}
