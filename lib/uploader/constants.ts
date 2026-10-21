/**
 * Tour uploader (agent #3) - every number the feature tunes, in one place. Spec:
 * docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md. Pure - no DB, no network.
 *
 * A rule that wants one of these imports it; nothing else in lib/uploader/ may hold a
 * copy of the number, or tuning it in one file would leave the others behind.
 */

/** A show within this many km of a `locations` row with an IATA code gets a package (flight + hotel). */
export const NEAR_LOCATION_KM = 50;

/** A venue whose nearest location is between `NEAR_LOCATION_KM` and this many km gets the two-city offer (`far_venue`); beyond it, nothing is offered. */
export const FAR_VENUE_KM = 300;

/** Days before a show the site stops selling it - main's `AVAILABILITY_WINDOW_DAYS`, so the uploader does not find what the site would hide. */
export const SHOW_WINDOW_DAYS = 3;

/** A rejection needs a reason of at least this many characters - the reason is what the agent learns from. */
export const REJECT_REASON_MIN = 3;

/** How often the toast polls for a run waiting on a question (ms). */
export const TOAST_POLL_MS = 60_000;

/**
 * How often the review board re-reads a run its own build loop is not driving - waiting on people,
 * or a build another open board is running (ms). While this board's loop runs it refreshes after
 * every step instead (there is no faster poll).
 */
export const BOARD_IDLE_POLL_MS = 15_000;

/** A markup (`ticket_only_markup`, `event_additional_markup`) is a whole number of dollars from 0 up to this. */
export const MARKUP_MAX = 5000;

/** The longest subject name or round text a plan accepts (characters, after trimming). */
export const NAME_MAX = 120;

/** The most entries in any plan list (cities to include / exclude, notes). */
export const LIST_MAX = 20;

/** The longest note a plan keeps (characters, after trimming); a city in a plan list is at most NAME_MAX. */
export const NOTE_MAX = 300;

/**
 * The widest window a plan searches: `date_to` at most this many months after the window's start
 * (`date_from`, never before today + SHOW_WINDOW_DAYS), and an open-ended plan ends there.
 * TixStock lists placeholder rows years out (2030), and an unbounded `date_to` fanned one search
 * out into thousands of date slices (security review, 21.10).
 */
export const OPEN_WINDOW_MONTHS = 24;

/** `createRun` raises at most this many question tasks (a task + a mail each); further questions wait on the board without a task. */
export const MAX_QUESTION_TASKS_PER_RUN = 20;

/** `parseBrief` calls the model at most this many times per person per PARSE_RATE_WINDOW_MS (counted on the `agent.call` audit rows). */
export const PARSE_RATE_MAX = 10;
export const PARSE_RATE_WINDOW_MS = 10 * 60_000;

// The party a stored TixStock ticket price is for (`PRICED_PARTY`) is NOT re-exported here: the
// /uploader screens import this file on the client, and the re-export dragged the supplier modules
// into that bundle. Import it from "@/lib/tixstock-listings", the price sync's own constant.
