import { NextRequest, NextResponse } from 'next/server';
import { syncTixStockEvents } from '@/lib/services/tixstock-sync';

export async function POST(request: NextRequest) {
  try {
    const result = await syncTixStockEvents();
    return NextResponse.json({
      success: true,
      message: 'TixStock sync completed',
      result
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
