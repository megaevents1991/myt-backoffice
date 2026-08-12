import { NextResponse } from 'next/server';
import { syncTixStockEvents } from '@/lib/services/tixstock-sync';
import { guardAdminRoute } from '@/lib/auth/guards';
import { logAudit } from '@/lib/audit';

// Full feed sweep (~540 pages) takes several minutes.
export const maxDuration = 800;

export async function POST() {
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
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
