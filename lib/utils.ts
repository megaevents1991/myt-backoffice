import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { XS2Ticket } from "@/types/sports-events.types";
import { CURRENCIES } from "@/types/live-events.types";
import type {
  ReservationEventOrderInfo,
  ReservationEventOrderInfoItem,
} from "@/types/reservation.types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format price as EUR currency
 */
export function formatEUR(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
  }).format(price);
}

/**
 * Format price as specified currency
 */
export function formatCurrency(price: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(price);
}

/**
 * Get net price in EUR from ticket data
 * Prioritizes local_rates.net_rate_eur, falls back to net_rate converted from cents
 * Both values are in cents and need to be divided by 100
 */
export function getTicketNetPriceEUR(ticket: XS2Ticket): number {
  return (ticket.local_rates?.net_rate_eur ?? ticket.net_rate) / 100;
}

/**
 * Get face value price in EUR from ticket data
 * Prioritizes local_rates.face_value_eur, falls back to face_value converted from cents
 * Both values are in cents and need to be divided by 100
 */
export function getTicketFaceValueEUR(ticket: XS2Ticket): number {
  return (ticket.local_rates?.face_value_eur ?? ticket.face_value) / 100;
}

/**
 * Format ticket net price as EUR currency string
 */
export function formatTicketNetPrice(ticket: XS2Ticket): string {
  return formatEUR(getTicketNetPriceEUR(ticket));
}

/**
 * Format ticket face value as EUR currency string
 */
export function formatTicketFaceValue(ticket: XS2Ticket): string {
  return formatEUR(getTicketFaceValueEUR(ticket));
}

/**
 * Get currency code from LIVE currency ID
 */
export function getLiveCurrencyCode(currencyId: number): string {
  switch (currencyId) {
    case CURRENCIES.USD: return "USD";
    case CURRENCIES.EUR: return "EUR";
    case CURRENCIES.GBP: return "GBP";
    case CURRENCIES.ILS: return "ILS";
    default: return "EUR";
  }
}

/**
 * Check if hotel order info is present (not empty object)
 */
export function hasHotelInfo(hotelInfo: unknown): boolean {
  return !!hotelInfo && typeof hotelInfo === 'object' && Object.keys(hotelInfo).length > 0 && 'name' in hotelInfo;
}

export function normalizeReservationEventOrderInfo(
  eventOrderInfo: ReservationEventOrderInfo | null | undefined
): ReservationEventOrderInfoItem[] {
  if (!eventOrderInfo) return [];
  if (
    typeof eventOrderInfo === "object" &&
    "events" in eventOrderInfo &&
    Array.isArray((eventOrderInfo as { events?: unknown }).events)
  ) {
    return (eventOrderInfo as { events: ReservationEventOrderInfoItem[] }).events;
  }
  return [eventOrderInfo as ReservationEventOrderInfoItem];
}

export function getReservationEventOrderInfoPrimaryName(
  eventOrderInfo: ReservationEventOrderInfo | null | undefined
): string {
  const events = normalizeReservationEventOrderInfo(eventOrderInfo);
  return events[0]?.name || "Unknown";
}

/** The message of whatever a `catch` caught: an Error, a Supabase error object (it carries
 *  `message` but is not always an Error), or anything else. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
