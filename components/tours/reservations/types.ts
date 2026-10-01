/** Shapes of a tours company's reservations, shared by the actions and the screens. */

/** One row of the Reservations screen: a booking (+pax) or a cancellation (-pax) on a departure. */
export interface ToursReservationRow {
  id: string;
  createdAt: string;
  departureId: string;
  departureCode: string;
  /** yyyy-mm-dd */
  departureDate: string | null;
  tourName: string | null;
  pax: number;
  /** The accounting (Docket) number. */
  docketNo: string | null;
  note: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  /** The site lead it was made from. */
  leadId: string | null;
  enteredBy: string | null;
}

/** A departure the reservation dialog offers. */
export interface ReservationDeparture {
  id: string;
  code: string;
  /** yyyy-mm-dd */
  startDate: string;
  tourName: string | null;
  isPublished: boolean;
  /** The id the customer site uses for it (?product_id=). */
  siteId: number;
}

export interface ReservationInput {
  departureId: string;
  /** +travelers for a booking, -travelers for a cancellation. */
  pax: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  docketNo?: string | null;
  note?: string | null;
  leadId?: string | null;
}

/** What a lead already knows, to open the reservation dialog pre-filled. */
export interface ReservationPrefill {
  leadId?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  note?: string | null;
  /** The site id of the departure the lead was sent from (?product_id=). */
  siteId?: number | null;
}
