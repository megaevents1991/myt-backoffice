// app/api/p1-events/events/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';
import { P1EventDB } from '@/types/p1-events.types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const series = searchParams.get('series');
    const eventId = searchParams.get('event_id');
    const upcomingOnly = searchParams.get('upcoming') !== 'false';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;

    let query = supabase
      .from('p1_events')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .order('date_start', { ascending: true });

    if (upcomingOnly) {
      query = query.gte('date_start', new Date().toISOString());
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (series) {
      query = query.eq('series_name', series);
    }

    if (eventId) {
      query = query.eq('event_id', eventId);
    }

    // Try to get ALL data by fetching in chunks if needed
    let allData: P1EventDB[] = [];
    let from = 0;
    const chunkSize = 1000;
    let hasMore = true;

    console.log('Starting to fetch P1 events...');

    while (hasMore) {
      const { data: chunkData, error } = await query
        .range(from, from + chunkSize - 1);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (chunkData) {
        allData.push(...(chunkData as unknown as P1EventDB[]));
        console.log(`Fetched chunk: ${from} to ${from + chunkData.length - 1}, total so far: ${allData.length}`);
      }

      hasMore = chunkData && chunkData.length === chunkSize;
      from += chunkSize;

      // Safety break
      if (from > 20000) {
        console.warn('Safety break: fetched 20k+ events');
        break;
      }
    }

    console.log(`Total P1 events fetched: ${allData.length}`);

    // Apply limit if specified
    const finalData = limit ? allData.slice(0, limit) : allData;

    return NextResponse.json({ 
      success: true, 
      data: finalData, 
      timestamp: new Date().toISOString(),
      debug: {
        totalEvents: allData.length,
        returnedEvents: finalData.length,
        category,
        series,
      }
    }, { 
      headers: { 
        'Cache-Control': 'no-store' 
      }
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { 
      status: 500 
    });
  }
}
