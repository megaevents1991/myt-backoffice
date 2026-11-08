/**
 * Mega Events' send decision (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, section 9): for
 * each queued order update, send / skip with a reason in Hebrew (printed on the order) / wait. Pure - the drain
 * (lib/services/whatsapp-events-outbox.ts) reads, this decides. Selftest: scripts/whatsapp-events-selftest.ts.
 */
import { whatsappPhone } from "@/lib/tours/cases";
import { israelToday } from "@/lib/marketing/range";

export const OUTBOX_KINDS = [
  "payment_received",
  "payment_failed",
  "phone_order",
  "materials_sent",
  "order_cancelled",
  "flight_reminder",
  "event_today",
  "after_trip",
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** The kinds that wait for a date of the order (E3); they need the order still Paid. */
export const DATE_KINDS: ReadonlySet<OutboxKind> = new Set(["flight_reminder", "event_today", "after_trip"]);

export type OutboxRowLite = { id: string; kind: OutboxKind; reservationId: number; dueAt: string; fromStatus: string | null; createdAt: string };
export type OrderLite = {
  id: number;
  status: string;
  isDeleted: boolean;
  whatsappOffAt: string | null;
  itineraryGroup: string | null;
  phone: string | null;
  phoneKey: string;
  eventId: number | null;
  eventDate: string | null;
  createdAt: string;
  /** A payment_received of this order was sent (the order was paid since launch). */
  paymentReceivedSent: boolean;
};
export type DecisionEnv = { auto: boolean; approved: Set<string> };
export type Decision = { act: "send"; to: string } | { act: "skip"; reason: string } | { act: "wait" };

export const TEMPLATE_LANGUAGE = "he";
const skip = (reason: string): Decision => ({ act: "skip", reason });

/** Does the order still match what its message says? */
function stillMatches(kind: OutboxKind, status: string): boolean {
  if (kind === "payment_received") return status === "Paid";
  if (kind === "payment_failed") return status !== "Paid" && status !== "Cancelled";
  if (kind === "phone_order") return status === "Pending";
  if (kind === "order_cancelled") return status === "Cancelled";
  if (kind === "materials_sent") return status !== "Cancelled";
  return status === "Paid"; // the date kinds
}

export function outboxDecision(row: OutboxRowLite, order: OrderLite, newerPaidSameEvent: boolean, env: DecisionEnv, now: Date): Decision {
  if (Date.parse(row.dueAt) > now.getTime()) return { act: "wait" };
  if (!env.auto) return skip("הופסק ידנית");
  if (order.isDeleted) return skip("ההזמנה נמחקה");
  if (order.whatsappOffAt) return skip("כבוי להזמנה הזו");
  // a Euro Trip is one row per event: every update would go out once per row (not in this round)
  if (order.itineraryGroup) return skip("טיול יורו - לא בסבב הזה");
  const to = whatsappPhone(order.phone);
  if (!to) return skip("אין טלפון תקין");
  if (!env.approved.has(`${row.kind}:${TEMPLATE_LANGUAGE}`)) return skip("התבנית לא אושרה");
  if (!stillMatches(row.kind, order.status)) return skip("ההזמנה השתנתה");
  const today = israelToday(now);
  if (row.kind === "payment_received" && order.eventDate && order.eventDate < today) return skip("האירוע עבר");
  // a retry inserts a NEW reservation: a customer who paid on it must not hear the first try failed
  if (row.kind === "payment_failed" && newerPaidSameEvent) return skip("שולם בהזמנה חדשה");
  if (row.kind === "order_cancelled" && row.fromStatus !== "Paid" && !order.paymentReceivedSent) return skip("ההזמנה לא שולמה");
  if (DATE_KINDS.has(row.kind) && israelToday(new Date(row.dueAt)) < today) return skip("עבר הזמן");
  return { act: "send", to };
}
