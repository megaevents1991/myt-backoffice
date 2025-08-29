import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { XS2Ticket } from "@/types/sports-events.types";
import { LiveTicketCategory, CURRENCIES } from "@/types/live-events.types";

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
 * Format LIVE ticket price with proper currency
 */
export function formatLiveTicketPrice(ticket: LiveTicketCategory, currencyId: number): string {
  const currencyCode = getLiveCurrencyCode(currencyId);
  return formatCurrency(ticket.cost, currencyCode);
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
