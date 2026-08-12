# Cross-Project Rule (always-on) - myt-backoffice

This backoffice writes the Supabase data `../myt-main` reads, and calls some of its APIs.

## Types - keep in sync
- `types/app.types.ts` ↔ main `lib/app.types.ts`: `Event, EventType, Flight, FlightSegment,
  Order, OrderHotel, OrderTicket, FlightSearchOptions, TimeRange, AffiliateTracking, VipConfig,
  EventTicket`.
- **Known intentional diffs:** backoffice `EventType` has extra `sports_live_event_dynamic`;
  backoffice `Flight` uses simplified airline metadata.
- Edit any shared type → run `/sync-types` and update the main copy. See [[pricing]].

## APIs the backoffice CALLS on the main app (don't assume you can change them freely)
- `GET /api/hotels` (`lat,lon,checkin,checkout,secret`), `GET /api/revalidate` (`secret`),
  `GET /api/flights/search`. If you change how the backoffice calls these, confirm main's
  contract still matches.

## Shared tables
- Backoffice writes/manages `events, partners, hotels(read), flights`; main reads `events,
  partners, flights` and writes `reservations, hotels`. Don't rename/drop columns the main app
  depends on without updating it.
