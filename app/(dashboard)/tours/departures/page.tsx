import { Suspense } from "react";
import { cookies } from "next/headers";
import { DeparturesBoard } from "@/components/tours/departures/departures-board";
import { DeparturesScreen } from "@/components/tours/departures/departures-screen";
import { getSession } from "@/lib/auth/guards";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";

export const metadata = { title: "Departures" };

/**
 * Departures of the active company (product type "tours").
 *
 * Staff get the departures sheet: Departures and Pricing as one table, edited
 * like a spreadsheet (DeparturesScreen). `?board=classic` opens the old board,
 * which still lists vacation packages and deleted dates. Both load their own
 * data through server actions; Suspense: they read the query string.
 *
 * A sales agent of the company (role tours_agent) gets the old board read
 * only. The flag below only tells the board what to draw from the first
 * paint; what that viewer may read and that it may change nothing are decided
 * by the server actions (requireCompanyViewer / requireCompany).
 *
 * The role is the live one, else the one the cookie was signed with: a
 * disabled agent has no live session, and must still see the agent's screen
 * (with the server's refusal in it), not the staff one.
 */
export default async function ToursDeparturesPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const { board } = await searchParams;
  const live = await getSession();
  const signed = live ? null : await verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  const role = (live ?? signed)?.role;
  const agent = role === TOURS_AGENT_ROLE;
  return (
    <Suspense fallback={null}>{agent || board === "classic" ? <DeparturesBoard readOnly={agent} /> : <DeparturesScreen />}</Suspense>
  );
}
