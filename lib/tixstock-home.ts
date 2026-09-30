// Home-game heuristic (spec 2026-09-02, decision 4): the event name starting
// with the team name means a home game ("Arsenal vs Chelsea" is at Arsenal).
// Doubtful rows are left for a manual pick rather than auto-included.
import { normalizeForSearch } from "@/lib/search";
import type { TixStockEventDB } from "@/types/tixstock.types";

export function isHomeGame(eventName: string, teamName: string): boolean {
  const event = normalizeForSearch(eventName);
  const team = normalizeForSearch(teamName);
  if (!event || !team) return false;
  return event.startsWith(team);
}

/**
 * The team a fixture belongs to for grouping: the performer whose name opens
 * the event name (= the home side), else the first performer. Wizard steps and
 * the selection chips group by this.
 */
export function homeTeamOf(event: TixStockEventDB): string {
  const performers = event.performers ?? [];
  const home = performers.find((performer) =>
    isHomeGame(event.event_name, performer.name),
  );
  return home?.name ?? performers[0]?.name ?? "—";
}

/**
 * The batch wizard's group: one home team at one venue. A team's home games
 * share a ground, so the dragged form (location, map, zones) carries between
 * them; an artist's tour is one performer across many venues and each venue
 * must start fresh (2026-09-30: Oasis Munich was saved with the Etihad's map,
 * zones and London flight). The venue is normalised so TixStock's spellings of
 * one ground ("Red Bull Arena - Leipzig", accents) stay one group.
 */
export function batchGroupOf(event: TixStockEventDB): string {
  return `${homeTeamOf(event)}|${normalizeForSearch(event.venue_name ?? "")}`;
}
