import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('live_performers')
      .select('*')
      .order('performer_name');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    }, { 
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error: any) {
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
