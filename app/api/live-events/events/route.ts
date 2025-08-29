import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
  const eventType = searchParams.get('type'); // sports_event_dynamic / music_event_dynamic
  const category = searchParams.get('category');
  const performer = searchParams.get('performer');
  const eventId = searchParams.get('event_id');
    const upcomingOnly = searchParams.get('upcoming') !== 'false';
    const limit = parseInt(searchParams.get('limit') || '500');

    let query = supabase
      .from('live_events')
      .select(`*`)
      .eq('is_active', true)
      .order('show_date', { ascending: true })
      .limit(limit);

    if (upcomingOnly) {
      query = query.gte('show_date', new Date().toISOString());
    }
    if (eventType && eventType !== 'all') {
      query = query.eq('event_type', eventType);
    }
    if (category) {
      query = query.eq('primary_category', category);
    }
    if (performer) {
      // Filter events whose performers JSON array contains an object with matching name
      // PostgREST .contains uses JSON containment; we pass subset array with name only
      query = query.contains('performers', [{ name: performer }]);
    }
    if (eventId) {
      query = query.eq('event_id', eventId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' }});
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
