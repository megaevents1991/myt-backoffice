// A `ticket_bookings` row and its files as the reservation's ticket card shows them. Read as unknown and shaped
// here, so the card never guesses at a column: a row with an env / source / status we do not know is not shown.
// Pure. Selftest: scripts/tixstock-booking-rank-selftest.ts.
import {
  isBookingStatus,
  ourOrderId,
  readListingSnapshot,
  safeHttpUrl,
  ticketPageUrl,
  type AttendeeInput,
  type BookingEnv,
  type BookingStatus,
  type Buyer,
  type ListingSnapshot,
} from "./rules";

export type TicketBookingView = {
  id: string;
  reservationId: number;
  env: BookingEnv;
  source: "office" | "site";
  status: BookingStatus;
  /** The id TixStock's orders/add returned. */
  tixstockOrderId: string | null;
  /** The `order_id` we sent: what TixStock's support and Request Logs know the order by. */
  ourOrderId: string;
  quantity: number;
  listing: ListingSnapshot;
  pricePerTicket: number | null;
  total: number | null;
  orderCurrency: string | null;
  orderTotal: number | null;
  /** The ticket cost the order was sold with, for the party. */
  costSoldUsd: number | null;
  buyer: Buyer;
  attendees: AttendeeInput[];
  lastError: string | null;
  createdAt: string;
  approvedAt: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  sentToCustomerAt: string | null;
  sentChannels: string[];
  releasedToCustomerAt: string | null;
  customerPageUrl: string;
  /** Minutes the order has stood as Sale on Hold (TixStock expects Approved within two hours); else null. */
  saleOnHoldMinutes: number | null;
  uncertainResolution: unknown;
};

export type TicketFileView = {
  id: string;
  kind: string;
  row: string | null;
  seat: string | null;
  /** Something staff can open: a signed URL of a stored file, or a seller's http(s) link. */
  href: string | null;
  /** A seller's link that is NOT an http(s) URL: shown as text, never as a link. */
  text: string | null;
  receivedAt: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? { ...v } : {});

const buyerOf = (v: unknown): Buyer => {
  const o = rec(v);
  return { first_name: str(o.first_name) ?? "", last_name: str(o.last_name) ?? "", email: str(o.email) ?? "", phone: str(o.phone) ?? "" };
};

const attendeesOf = (v: unknown): AttendeeInput[] =>
  (Array.isArray(v) ? v : []).flatMap((raw): AttendeeInput[] => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const o = rec(raw);
    const attendee: AttendeeInput = { first_name: str(o.first_name) ?? "", last_name: str(o.last_name) ?? "" };
    const passport = str(o.passport);
    const nationality = str(o.nationality);
    const dob = str(o.dob);
    const birthPlace = str(o.birth_place);
    if (passport) attendee.passport = passport;
    if (nationality) attendee.nationality = nationality;
    if (dob) attendee.dob = dob;
    if (o.gender === "M" || o.gender === "F") attendee.gender = o.gender;
    if (birthPlace) attendee.birth_place = birthPlace;
    return [attendee];
  });

export function toBookingView(row: Record<string, unknown>, now: Date): TicketBookingView | null {
  const id = str(row.id);
  const reservationId = num(row.reservation_id);
  const token = str(row.customer_token);
  if (!id || reservationId === null || !token) return null;
  if (row.env !== "sandbox" && row.env !== "production") return null;
  if (row.source !== "office" && row.source !== "site") return null;
  if (!isBookingStatus(row.status)) return null;

  const since = str(row.updated_at) ?? str(row.created_at);
  const sinceMs = since ? new Date(since).getTime() : NaN;
  return {
    id,
    reservationId,
    env: row.env,
    source: row.source,
    status: row.status,
    tixstockOrderId: str(row.tixstock_order_id),
    ourOrderId: ourOrderId(reservationId, id),
    quantity: num(row.quantity) ?? 0,
    listing: readListingSnapshot(row.listing),
    pricePerTicket: num(row.price_per_ticket),
    total: num(row.total),
    orderCurrency: str(row.order_currency),
    orderTotal: num(row.order_total),
    costSoldUsd: num(row.cost_sold_usd),
    buyer: buyerOf(row.buyer),
    attendees: attendeesOf(row.attendees),
    lastError: str(row.last_error),
    createdAt: str(row.created_at) ?? "",
    approvedAt: str(row.approved_at),
    checkedAt: str(row.checked_at),
    checkedBy: str(row.checked_by),
    sentToCustomerAt: str(row.sent_to_customer_at),
    sentChannels: Array.isArray(row.sent_channels) ? row.sent_channels.filter((c): c is string => typeof c === "string") : [],
    releasedToCustomerAt: str(row.released_to_customer_at),
    customerPageUrl: ticketPageUrl(token),
    saleOnHoldMinutes: row.status === "sale_on_hold" && Number.isFinite(sinceMs) ? Math.floor((now.getTime() - sinceMs) / 60_000) : null,
    uncertainResolution: row.uncertain_resolution ?? null,
  };
}

/** `signedUrl` = the short-lived URL of a file kept in the private bucket; null for a link, or when none was made. */
export function toFileView(file: Record<string, unknown>, signedUrl: string | null): TicketFileView {
  const link = str(file.url);
  const safeLink = safeHttpUrl(link);
  return {
    id: str(file.id) ?? "",
    kind: str(file.kind) ?? "",
    row: str(file.row),
    seat: str(file.seat),
    href: signedUrl ?? safeLink,
    text: !signedUrl && link && !safeLink ? link : null,
    receivedAt: str(file.received_at),
  };
}
