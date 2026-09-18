/**
 * The picture an event card shows on the /homepage board when the event has no
 * image of its own: its artist's or team's, the way the site does it
 * (myt-main `lib/events/fallbackImage.ts` - an event borrows the matching
 * person's art). Most events carry no image, so without this the board's event
 * cards are grey boxes while the site shows Celine Dion.
 *
 * Pure, and an APPROXIMATION on purpose: the site also rotates an artist's
 * gallery cut-outs per event and draws "crest VS crest" for fixtures - a board
 * thumbnail only needs to be recognisable, so a fixture gets its HOME team's
 * picture. Name matching is main's own rule, mirrored in lib/on-tour.ts.
 *
 * Relative import on purpose - the selftest runs without the `@/` alias.
 */

import { eventMatchesName, normalizeName } from "../on-tour";

export interface ArtPerson {
  kind: "artist" | "team";
  name_english: string | null;
  image_url: string | null;
}

export interface ArtIndexEntry {
  kind: "artist" | "team";
  /** As stored - eventMatchesName wants the raw name. */
  name: string;
  /** normalizeName(name), computed once. */
  norm: string;
  image_url: string;
}

/**
 * People with both an English name and a picture, longest name first so the
 * most specific one wins ("Sia" never grabs an "Asia" event).
 */
export function buildArtIndex(people: ArtPerson[]): ArtIndexEntry[] {
  const out: ArtIndexEntry[] = [];
  for (const p of people) {
    const name = p.name_english?.trim();
    if (!name || !p.image_url) continue;
    const norm = normalizeName(name);
    if (norm) out.push({ kind: p.kind, name, norm, image_url: p.image_url });
  }
  return out.sort((a, b) => b.norm.length - a.norm.length);
}

const VS = /\s+vs\.?\s+/i;

/** The artist's / home team's picture for this event, or null when nobody matches. */
export function personArtFor(
  eventNameEnglish: string | null | undefined,
  index: ArtIndexEntry[],
): string | null {
  const raw = eventNameEnglish?.trim();
  if (!raw || !index.length) return null;
  const norm = normalizeName(raw);
  const fixture = VS.test(raw);

  // Cheap gate first - a board load is ~2,000 events x ~200 people, and the
  // full rule normalises both sides on every call. A plain substring decides
  // nearly every pair; only a fixture can match a team WITHOUT containing its
  // name ("Atlético de Madrid" vs the team "Atletico Madrid"), so only fixtures
  // pay for the token rule, and only against teams.
  const matches = index.filter(
    (p) =>
      (norm.includes(p.norm) || (fixture && p.kind === "team")) && eventMatchesName(raw, p.name),
  );
  if (!matches.length) return null;
  if (!fixture) return matches[0].image_url;

  // A fixture matches both clubs; the game is the home side's.
  const home = normalizeName(raw.replace(/^[^:]+:\s*/, "").split(VS)[0]);
  const homeMatch = matches.find(
    (p) => p.kind === "team" && (home.includes(p.norm) || eventMatchesName(home, p.name)),
  );
  return (homeMatch ?? matches[0]).image_url;
}
