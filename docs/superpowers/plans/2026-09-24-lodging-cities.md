# Lodging Cities (B-min + C1 + C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An event can name an *event city* next to its *flight city*; the site's hotel step gets one line `הלינה ב: <עיר>` with a button for the other city and a "מפוצל" popup that assigns each night (inside the chosen flight dates) to a city, giving 2-3 hotel segments per order. Plus a manual "טען מלונות" that warms RateHawk static data for a cold city.

**Architecture:** Five defaulted columns on `events` + `reservations.hotel_segments jsonb` + table `hotel_warm_areas`. ALL rules live in one pure module mirrored in both repos (`lib/lodging.ts` ↔ main `lib/events/lodging.ts`): offered cities, default city, default split, night→segment merge (max 3), nights derived from the chosen checkin/checkout. Main keeps `hotel` = first segment (every single-hotel gate keeps working) and adds `hotelSegments` for the rest; price sums segments. Warm-up = `POST /api/hotels-warm` in main (secret header), ~12 `hotel/info` per call, called in a loop from a backoffice button.

**Tech Stack:** as part A. Main UI uses Mantine `Modal` (already in the order flow).

**Spec:** `docs/superpowers/specs/2026-09-20-lodging-destinations-design.md` v5.3 blocks (v5, v5.1 flow, v5.2 UI, v5.3 no date change) + v4 model.

## Global Constraints
- Backoffice on `master`; main on the SAME branch `feat/ticket-only-events` (Dor 24.09). Never push; commit only own files.
- Two cities only: flight city = `events.location` (unchanged, always offered, carries `city_iata`); event city = `events.event_location` (`{name, latitude, longitude, country_code?}`, null = same city).
- `lodging_mode`: `flight_city` (default, today) | `event_city_only` | `choice` | `choice_split`. `lodging_default`: `flight` | `event`. `split_default_nights`: 1 | 2 (2 = night before + event night). `lodging_note` free text shown under the toggle.
- Split popup never changes dates (v5.3). Max 3 segments. "לא צריך מלון" stays global. Offline hotels: offered only when there is a single segment (unchanged code path).
- Copy: `הלינה ב:` · `ברירת מחדל` · `מפוצל` · `שינוי הפיצול` · popup title `איפה ישנים בכל לילה?` · `החלפת מלון` · card `"{event city} · טיסה ל{flight city}"`.
- RateHawk: `serp/geo` 10/min shared with customers → per-segment searches run SEQUENTIALLY; warm-up ≤ 12 `hotel/info` per call, 2.5 s apart.

## Tasks
1. **Schema + types + pure lib (both repos)** — migration, `Event`/`OrderHotel`/reservation types, `lib/lodging.ts` + selftest, mirror in main.
2. **Backoffice editor "Lodging" card + venue memory** — event city from the Locations dropdown, mode/default/nights/note, validation (`lodgingProblems`), copied by `findVenueMemory`.
3. **B-min warm-up** — main `POST /api/hotels-warm`; backoffice action `warmHotelsStep` + `hotel_warm_areas`; `HotelWarmButton` in Locations cards and both editor location cards.
4. **Main C1** — `lib/events/lodging.ts`, context state (`lodgingCity`, `hotelSegments`), `LodgingToggle` above the list, search by chosen city (`requestKey` gains location), card/header "X · טיסה לY".
5. **Main C2** — `SplitStayDialog` (night strip), `SegmentsList` (sequential search + auto-pick + "החלפת מלון" modal), pricing over segments, summary per segment, submit `hotel_segments`, confirm-order persist + email.
6. **Backoffice reservations detail** — segments loop; guide + CLAUDE.md; QA form rows 13-24 (same artifact).
