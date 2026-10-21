/**
 * Who is looking at the Reservations board (Alon's TODAY round, 21.10.2026): a MANAGER sees every card of the
 * company and assigns in bulk; a REP sees their own cards and the unassigned ones. The rule itself is pure
 * (lib/tours/board.ts boardViewerOf); this is the one read behind it - the viewer's role in the active company.
 * Server-only (service client): called by the tours actions after requireCompany(), never from the client.
 */
import { supabaseTyped } from "@/lib/supabase-server";
import type { Company } from "@/lib/company";
import type { SessionPayload } from "@/lib/auth/session";
import { boardViewerOf, type BoardViewer } from "@/lib/tours/board";

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
