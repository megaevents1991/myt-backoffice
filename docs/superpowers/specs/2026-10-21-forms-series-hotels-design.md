# Feedback forms per series + a question per hotel (2026-10-21)

Source: Alon's tab in "ROAD MAP MEGATR" (`t.dbfsznumjv2e`), Dor's answers in chat 21.10.

## Why

Today ONE form (#5 "משוב על הטיול") serves every organized-trip series. Its trip links carry
the trip code (series letters + number), the escort and the departure date, typed by hand.
Alon wants each series to ask its own questions, and above all to rate each HOTEL of the
route by city ("איך היה המלון בלונדון", "איך היה המלון בפריז"), so a weak hotel shows up by
name and he knows whom to call or what to change.

## Decided (Dor)

- A form per SERIES. Every trip of the series answers the same questions; between series
  questions are added, edited and ordered freely.
- The hotels of a route are written ONCE in the series form (city + hotel name), not per trip.
- The client sees the hotel's name under the question ("איך היה המלון בלונדון" + "DoubleTree").
- Nothing that exists may break: form #5, its 193 answers, 20 trip links and its report stay.

## What is built

1. **A form can belong to a series** - `forms.series_id` (tours.series, the series codes
   BBC / FPAR / CBEA... are exactly the codes the trip links already use). Set in the builder
   ("Series"); `/forms` shows the series and "New series form" = copy a base form (default the
   newest form) into a draft tied to the chosen series. A series with no form of its own keeps
   using #5 - nothing forces a move.
2. **A trip link picks its departure** - the trip-link card lists the series' departures
   (every series' when the form has none), recent and coming first. Picking one fills the code
   (series letters + the departure's number, BBC703 -> BBC-703), the departure date (the first
   staff date question - the same rule the report reads it by) and stores
   `form_invites.departure_id`. Typing by hand stays. The escort box suggests names already
   used on trip links and the guides list.
3. **Hotel question** - a star rating with `config.hotel = { city_he, city_en, name }`.
   Still a rating: averages, the Google gate and every report read it unchanged. The builder
   offers "Hotel rating" in Add question; the question's wording follows the city until staff
   rewrite it. The public form prints the hotel name under the question.
4. **The answer remembers the hotel** - `form_responses.field_context = { hotels: { "<fieldId>":
   { city, name } } }`, written at submit. When the hotel of a series changes, staff edit the
   form: new answers go to the new hotel, old ones stay with the old (my call, said in chat).
   A response with no snapshot (older ones) is read with the question's current hotel.
5. **Hotels report** - `/forms/hotels`: every hotel answer of every form (operators: the forms
   open to them), grouped by city + hotel name (`hotelKey`: trimmed, spaces collapsed, case
   and diacritics ignored), weakest average first: answers, trips, series, the weakest trip,
   last answer. Period filter. The per-form report's Questions tab names the hotel too.
6. **Copy a question to other forms** - on a saved question in the builder: tick forms (series
   forms first), it is appended at the end of each (a condition is dropped - it points at
   another form's question). My answer to "add one question to all 56 series".
7. **1 = poor, 5 = excellent** under every star rating on the public form.

## Not built (next)

- Stage 2 - escort feedback per series with per-trip hotels: the same pieces, plus "who
  answers" (clients / escorts) so the hotels report does not mix the two.
- A cross-series escorts view (today escorts compare inside one form).
- Pre-filling the trip size from the departure's bookings.

## Rules

Pure in `lib/forms/series.ts` (departure -> trip code, hotel key / label, hotel rows) with
`scripts/forms-series-selftest.ts`. Migration `20261021083328_forms_series_hotels.sql`:
three nullable columns, nothing rewritten. Every read and write of a new column tolerates
the migration not being applied yet (42703 / PGRST204), like `liveRowsQuery`.
