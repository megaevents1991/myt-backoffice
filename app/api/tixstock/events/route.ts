import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '50');

    let dbQuery = supabase
      .from('tixstock_events')
      .select('*')
      .eq('is_active', true)
      .order('show_date', { ascending: true })
      .limit(limit);

    if (query) {
      dbQuery = dbQuery.ilike('event_name', `%${query}%`);
    }

    const { data, error } = await dbQuery;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
