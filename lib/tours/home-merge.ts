/**
 * The home page editor's merge (pure): two people on the home page of a tours company at once.
 * The generic rules are lib/doc-merge.ts; this file names what it reports in the editor's own
 * words - "Tour finder > Tile "Families" > Title of the tour grid".
 *
 * Selftest: `npx tsx scripts/tours-home-merge-selftest.ts`.
 */
import { mergeDocs, type MergeCollision, type MergeResult } from "@/lib/doc-merge";
import { sectionKind, type HomeDoc } from "@/lib/tours/site-content";

/** The fields whose name in the editor is not the key in words. */
const FIELD_NAMES: Record<string, string> = {
  footerTiles: "Tiles above the footer",
  gridTitle: "Title of the tour grid",
  moreLabel: 'Text of the "more" link',
  moreHref: 'Address of the "more" link',
  showGrid: "Show the tour grid before a search",
  allLabel: 'Name of the "all" pill',
  searchLabel: "Words on the search button",
  searchUrl: "The other site's search",
  pillTags: "Trip-type pills",
  pillsAlways: "Pills shown with no tour",
  salePills: "Trip-type pills",
  onlyTabs: "Tiles it shows for",
  visible: "Shown on the site",
  slides: "Pictures",
  banner: "Banner of this tile",
  titleBold: "Title (bold)",
  titleRest: "Title (rest)",
  label: "Name",
  title: "Title",
  tours: "Tours",
  items: "Items",
  rows: "Rows",
  limit: "How many",
  source: "What it shows",
  show: "What the tile shows",
  world: "World",
  term: "Term",
  icon: "Icon",
  color: "Color",
  text: "Text",
  mode: "Mode",
};

/** The lists whose items name themselves: the list's own name adds nothing to the path. */
const SELF_NAMED_LISTS = new Set(["sections", "tabs", "rows"]);

const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (c) => c.toUpperCase());

const quoted = (text: unknown): string => (typeof text === "string" && text.trim() ? ` "${text.trim()}"` : "");

function itemLabel(item: Record<string, unknown>, field: string): string {
  if (field === "sections") return `${sectionKind(String(item.type))?.label ?? "Section"}${quoted(item.title)}`;
  if (field === "tabs") return `Tile${quoted(item.label)}`;
  if (field === "rows") return `Row${quoted(item.title)}`;
  return String(item.label ?? item.title ?? item.id ?? item.key ?? "Item");
}

function fieldLabel(key: string): string | null {
  if (SELF_NAMED_LISTS.has(key)) return null;
  return FIELD_NAMES[key] ?? words(key);
}

/** Merges my copy of the home page onto the one saved now, both edited from `base`. */
export function mergeHomeDocs(base: HomeDoc, mine: HomeDoc, theirs: HomeDoc): MergeResult<HomeDoc> {
  return mergeDocs(base, mine, theirs, { item: itemLabel, field: fieldLabel });
}

/** A plain value as the list of collisions prints it. */
function shownValue(value: string | number | boolean | null): string {
  if (value === null || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "on" : "off";
  const text = String(value);
  return `"${text.length > 80 ? `${text.slice(0, 79)}…` : text}"`;
}

/** One line of the editor's list of collisions; `who` = the person whose save came in. */
export function collisionLine(collision: MergeCollision, who: string): string {
  const where = collision.path.join(" › ") || "The page";
  switch (collision.kind) {
    case "both_changed":
      return `${where} - you both changed it: yours is kept.${collision.theirs === undefined ? "" : ` ${who} had: ${shownValue(collision.theirs)}.`}`;
    case "you_removed":
      return `${where} - you removed it and ${who} changed it: it is back. Remove it again if you meant to.`;
    case "they_removed":
      return `${where} - ${who} removed it and you changed it: yours is kept.`;
    case "order":
      return `${where === "The page" ? "The order of the sections" : `The order in ${where}`} - you both moved things: your order is kept.`;
  }
}
