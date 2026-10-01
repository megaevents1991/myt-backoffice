/** Where a tours row opens - one builder per screen, used by every link to it. */

/** A departure's card on the Tours board, optionally on one tab. */
export const departureHref = (code: string, tab?: "prices" | "flights") =>
  `/tours/departures?code=${encodeURIComponent(code)}${tab ? `&tab=${tab}` : ""}`;

/** The Tours board filtered to one series, in one season year or all of them. */
export const seriesBoardHref = (seriesCode: string, year: number | "all") =>
  `/tours/departures?series=${encodeURIComponent(seriesCode)}&year=${year}`;

/** A flight block's card: the shared flight screen, which shows the block panel for a tours company. */
export const blockHref = (id: number) => `/offline-flights/${id}`;

/** The look of an inline link inside tours tables and notices. */
export const linkClass =
  "font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
