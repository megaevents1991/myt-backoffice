import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('live_categories')
      .select('*')
      .order('category_name');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    }, { headers: { 'Cache-Control': 'no-store' }});
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
