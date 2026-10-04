// Ready package ("חבילה מוכנה") - a house-built prepared package attached to an
// event. Spec: docs/superpowers/specs/2026-10-04-ready-package-design.md.
// The jsonb shapes are `type` aliases, not interfaces, so they stay assignable
// to the generated `Json`.

export const READY_PACKAGE_MODES = ["off", "preview", "live"] as const;
/** `events.ready_package_mode`. Anything else read from the column counts as "off". */
export type ReadyPackageMode = (typeof READY_PACKAGE_MODES)[number];

export const READY_REFRESH_STATUSES = ["ok", "partial", "broken"] as const;
/** ok = every size up to the max is priced; partial = some are missing; broken = the default size is. */
export type ReadyRefreshStatus = (typeof READY_REFRESH_STATUSES)[number];

/** Which flight a refresh looks for. Dates are YYYY-MM-DD, times the supplier's own ISO strings. */
export type ReadyFlightSpec =
  | { mode: "none" }
  | { mode: "offline"; offlineId: number }
  | {
      mode: "live";
      airline: string | null;
      outboundFlightNumber: string | null;
      outboundDeparture: string;
      inboundFlightNumber: string | null;
      inboundDeparture: string;
      departureDate: string;
      returnDate: string;
    };

/** Which hotel a refresh looks for. */
export type ReadyHotelSpec =
  | { mode: "none" }
  | {
      mode: "offline";
      /** One inventory row id per room, as built (a room type booked twice appears twice). */
      rowIds: number[];
    }
  | {
      mode: "live";
      /** Worldota hotel id (the slug main's search returns). */
      hotelId: string;
      roomName: string;
      meal: string;
      checkin: string;
      checkout: string;
    };

export type ReadyPackageSpec = {
  ticket: { id: string | null; category: string };
  flight: ReadyFlightSpec;
  hotel: ReadyHotelSpec;
  /** The party size the package was built for - the picker opens on it. */
  defaultTravelers: number;
};

/** One priced composition, in the shapes main round-trips through reservations.*_order_info. */
export type ReadyVariant = {
  event_order_info: { [key: string]: unknown };
  flight_order_info: { [key: string]: unknown } | null;
  flight_skipped: boolean;
  hotel_order_info: { [key: string]: unknown } | null;
  hotel_skipped: boolean;
  /** Site price per traveller for this size, USD. Null when it could not be computed. */
  price_per_person: number | null;
  /** A photo of the hotel for the site's package view (online hotels only; never part of the order). */
  hotel_image?: string | null;
  built_at: string;
  /** Something the builder had to settle for ("the room changed, cheapest with breakfast taken"). */
  note?: string;
};

/** Keyed by party size as a string ("1".."6"). */
export type ReadyVariants = { [travelers: string]: ReadyVariant };

/** What the event editor's card shows. */
export type ReadyPackageView = {
  packageId: number;
  token: string;
  mode: ReadyPackageMode;
  allowEdit: boolean;
  maxTravelers: number;
  defaultTravelers: number;
  /** Sizes with a priced variant, ascending. */
  sizes: number[];
  pricePerPerson: number | null;
  refreshedAt: string | null;
  refreshStatus: ReadyRefreshStatus | null;
  refreshNote: string | null;
  /** One line per piece, for the card. */
  ticketLabel: string;
  flightLabel: string;
  hotelLabel: string;
  /** The link staff open to see it on the site (works in preview and live). */
  previewUrl: string;
};
