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
