// Who sees the fulfilment tools of a reservation (the TixStock ticket-booking card today; the hotel-booking panel
// reuses this file). While the tools are being proven they are for the superadmin alone; `NEXT_SECRET_FULFILMENT_OPEN
// = "true"` opens them to admins too. Nobody else ever sees them, whatever the flag says.
// Pure. Selftest: scripts/tixstock-booking-rank-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1.
import type { Role } from "@/types/auth.types";

export function fulfilmentVisibleTo(role: Role | undefined, openFlag: string | undefined): boolean {
  if (role === "superadmin") return true;
  return role === "admin" && openFlag === "true";
}

/**
 * Runs a guard that THROWS for the wrong role (`requireAdmin`) and answers with a boolean. The reservation page is
 * a client component every staff role opens: a ticket action must answer "hidden", never throw into that page.
 */
export async function adminOrHidden(guard: () => Promise<unknown>): Promise<boolean> {
  try {
    await guard();
    return true;
  } catch {
    return false;
  }
}
