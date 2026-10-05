import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-server';
import { guardAdminRoute } from '@/lib/auth/guards';
import { errorMessage } from '@/lib/utils';

export async function GET() {
  // Staff only - until 05.10 this answered anyone on the internet, no session needed.
  const denied = await guardAdminRoute();
  if (denied) return denied;

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
    }, { 
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: errorMessage(error)
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
