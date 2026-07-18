import { NextRequest, NextResponse } from 'next/server';
import { syncTixStockEvents } from '@/lib/services/tixstock-sync';
import { guardAdminRoute } from '@/lib/auth/guards';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  try {
    const result = await syncTixStockEvents();
    await logAudit({ action: "sync_triggered", entityType: "tixstock" });
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
