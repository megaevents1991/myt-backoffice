import type { Event, PackageMode } from "@/types/app.types";

export { PACKAGE_MODES } from "@/types/app.types";

/** True only for the literal 'ticket_only'. A missing/null/unknown value is the normal package flow. */
export function isTicketOnlyEvent(e: { package_mode?: PackageMode | string | null }): boolean {
  return e.package_mode === "ticket_only";
}

/**
 * Save-time rules for a ticket-only event, as human sentences (empty = valid).
 * The only hard rule today: the site prices it as ticket + ticket_only_markup, so the markup
 * must be a finite number >= 0 (0 is allowed - "sell at cost").
 */
export function ticketOnlyProblems(e: Pick<Event, "package_mode" | "ticket_only_markup">): string[] {
  if (!isTicketOnlyEvent(e)) return [];
  const m = e.ticket_only_markup;
  if (m == null || !Number.isFinite(Number(m)) || Number(m) < 0) {
    return ["Ticket-only event needs a Ticket-Only Markup (USD per ticket, 0 allowed)."];
  }
  return [];
}
