/**
 * Who is looking at the Reservations board (Alon's TODAY round, 21.10.2026): a MANAGER sees every card of the
 * company and assigns in bulk; a REP sees their own cards and the unassigned ones. The rule itself is pure
 * (lib/tours/board.ts boardViewerOf); this is the one read behind it - the viewer's role in the active company.
 * Server-only (service client): called by the tours actions after requireCompany(), never from the client.
 */
import { supabaseTyped } from "@/lib/supabase-server";
import type { Company } from "@/lib/company";
import type { SessionPayload } from "@/lib/auth/session";
import { boardViewerOf, canSeeCard, type BoardViewer } from "@/lib/tours/board";
import { UserError } from "@/lib/tours/action-kit";

/** A failed read answers a REP, never a manager - the safe direction. */
export async function boardViewerFor(session: SessionPayload, company: Company): Promise<BoardViewer> {
  let membershipRole: string | null = null;
  try {
    const { data, error } = await supabaseTyped
      .from("company_members")
      .select("role")
      .eq("user_id", session.sub)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) console.error("tours-board-viewer: membership read failed", JSON.stringify(error));
    else membershipRole = (data as { role?: string } | null)?.role ?? null;
  } catch (e) {
    console.error("tours-board-viewer:", e);
  }
  return boardViewerOf(session.sub, session.role, membershipRole);
}

/**
 * The same door as caseRecord(viewer), for an action that reaches a card through its BOOKING (a status move, a
 * payment): a rep touches only a card they can see; a manager any. No card (a booking with no lead) = open.
 */
export async function assertCardVisible(session: SessionPayload, company: Company, leadId: string | null | undefined): Promise<void> {
  if (!leadId) return;
  const viewer = await boardViewerFor(session, company);
  if (viewer.manager) return;
  const { data, error } = await supabaseTyped.from("leads").select("assigned_to").eq("company_id", company.id).eq("id", leadId).maybeSingle();
  if (error) throw new Error(`leads: ${error.message}`);
  if (data && !canSeeCard({ assignedTo: (data as { assigned_to: string | null }).assigned_to }, viewer)) throw new UserError("This card belongs to another rep");
}
