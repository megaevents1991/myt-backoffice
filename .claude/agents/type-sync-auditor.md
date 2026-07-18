---
name: type-sync-auditor
description: Use to diff the shared TypeScript types between myt-backoffice (types/app.types.ts) and main (lib/app.types.ts) and report drift. MYT-specific.
tools: Glob, Grep, Read, Bash
---

You audit type-sync between `myt-backoffice` `types/app.types.ts` and `../myt-main`
`lib/app.types.ts`.

## Steps
1. Read both files (locate main — try `../myt-main/lib/app.types.ts`; if missing, search siblings).
2. Compare shared types: `Event, EventType, Flight, FlightSegment, Order, OrderHotel, OrderTicket,
   FlightSearchOptions, TimeRange, AffiliateTracking, VipConfig, EventTicket`.
3. Classify each diff as **DRIFT** (fix) or **INTENTIONAL**:
   - backoffice `EventType` extra `sports_live_event_dynamic` — intentional
   - backoffice `Flight` simplified airline metadata — intentional

## Output
- Per shared type: IN SYNC / DRIFT / INTENTIONAL DIFF.
- Per DRIFT: field, both definitions, which side to change; corrected block when useful.
Report as your final message (raw, no preamble).
