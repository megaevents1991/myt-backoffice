import { redirect } from "next/navigation";

/** /tours/leads - folded into the one Reservations table (14.10.2026): every site form is a case there. */
export default function TourLeadsPage() {
  redirect("/tours/reservations?view=leads");
}
