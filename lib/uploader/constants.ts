/**
 * Tour uploader (agent #3) - every number the feature tunes, in one place. Spec:
 * docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md. Pure - no DB, no network.
 *
 * A rule that wants one of these imports it; nothing else in lib/uploader/ may hold a
 * copy of the number, or tuning it in one file would leave the others behind.
 */

/** A show within this many km of a `locations` row with an IATA code gets a package (flight + hotel). */
export const NEAR_LOCATION_KM = 50;

/** A venue this far from its nearest location is built, but warned about (`far_venue`) - the package would be a long transfer. */
export const FAR_VENUE_KM = 300;

/** Days before a show the site stops selling it - main's `AVAILABILITY_WINDOW_DAYS`, so the uploader does not find what the site would hide. */
export const SHOW_WINDOW_DAYS = 3;

/** A rejection needs a reason of at least this many characters - the reason is what the agent learns from. */
export const REJECT_REASON_MIN = 3;

/** How often the toast polls for a run waiting on a question (ms). */
export const TOAST_POLL_MS = 60_000;

/** How often the review board polls a running build (ms). */
export const BOARD_POLL_MS = 2_500;

/** A markup (`ticket_only_markup`, `event_additional_markup`) is a whole number of dollars from 0 up to this. */
export const MARKUP_MAX = 5000;

/** The longest subject name or round text a plan accepts (characters, after trimming). */
export const NAME_MAX = 120;

/** The most entries in any plan list (cities to include / exclude, notes). */
export const LIST_MAX = 20;

/**
 * The party a stored TixStock ticket price is for. Not redefined: the uploader prices a ticket
 * exactly like the price sync does, so it re-exports the sync's own constant.
 */
export { PRICED_PARTY } from "@/lib/tixstock-listings";
