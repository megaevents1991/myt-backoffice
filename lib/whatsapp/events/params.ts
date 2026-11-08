/**
 * The parameters of Mega Events' templates (spec 2026-11-08 section 10), in each draft's {{n}} order. A parameter never
 * holds a newline, a tab or 4+ spaces (Meta refuses it); the first name goes out only as one word of letters - a visitor
 * typed it - else "חברים" (the waiting-list message's word). Pure.
 */
import { NAME_ALLOWED, NO_NAME } from "@/lib/tours/waitlist-dates";
import type { OutboxKind } from "@/lib/whatsapp/events/outbox";

export type ParamSource = {
  firstName: string | null;
  orderId: number;
  /** The event and its city, as the customer's mail names it ("אוואסיס במנצ׳סטר"). */
  eventLabel: string;
  /** The event's name alone ("אוואסיס"). */
  eventName: string;
  /** Where "try again on the site" goes (payment_failed). */
  resumeUrl: string;
  /** What the mail carries, by the order's shape (documentsOf). */
  documents: string;
  flight?: { city: string; number: string; date: string; hour: string; airport: string };
  /** "<venue>, <city>" or the city alone (event_today). */
  place?: string;
};

export function cleanParam(s: string): string {
  return s.replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export function greetingName(first: string | null | undefined): string {
  const word = (first ?? "").trim().split(/\s+/)[0] ?? "";
  return NAME_ALLOWED.test(word) ? word : NO_NAME;
}

/** The documents line of payment_received / materials_sent, by what the order holds. */
export function documentsOf(o: { hasFlight: boolean; hasHotel: boolean }): string {
  if (o.hasFlight && o.hasHotel) return "אישור ההזמנה, כרטיסי הטיסה ושובר המלון";
  if (o.hasHotel) return "אישור ההזמנה ושובר המלון";
  if (o.hasFlight) return "אישור ההזמנה וכרטיסי הטיסה";
  return "אישור ההזמנה";
}

export function paramsFor(kind: OutboxKind, s: ParamSource): string[] {
  const name = greetingName(s.firstName);
  const id = String(s.orderId);
  const out = (() => {
    switch (kind) {
      case "payment_received":
        return [name, id, s.eventLabel, s.documents];
      case "payment_failed":
        return [name, s.eventLabel, s.resumeUrl];
      case "phone_order":
        return [name, s.eventLabel];
      case "materials_sent":
        return [name, s.eventLabel, s.documents];
      case "order_cancelled":
        return [name, s.eventLabel, id];
      case "flight_reminder": {
        const f = s.flight;
        return f ? [name, f.city, f.number, f.date, f.hour, f.airport] : [];
      }
      case "event_today":
        return [name, s.eventName, s.place ?? ""];
      case "after_trip":
        return [name, s.eventName];
    }
  })();
  return out.map(cleanParam);
}
