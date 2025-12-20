# Flight JSON Inspector (Local)

A tiny, **standalone** inspection tool to visually explore an Amadeus-style `flights.json` response.

- No Next.js / app code usage
- No server required
- Works by loading a local `.json` file via a file picker

## How to use

1. Open `local-tools/flight-json-inspector/index.html` in your browser.
2. Click **JSON file** and select your `flights.json`.
3. Use the filters to narrow down results.
4. Click a row to see the raw JSON for that offer.

## What it shows

It renders a table of `data[]` flight offers with common fields:

- `id`
- `price.grandTotal` + `price.currency`
- `validatingAirlineCodes`
- `numberOfBookableSeats`
- Outbound / inbound total duration
- `type`

## Notes

- Sorting is done by clicking column headers.
- Filtering is client-side and instant.
- If your JSON isn’t in the Amadeus format (top-level `data` array), the tool will show an error.
