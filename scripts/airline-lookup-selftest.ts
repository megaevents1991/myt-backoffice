// Self-test for the airline-code check behind the offline flight forms' "Validate"
// button (lib/airline-lookup.ts). Synthetic avcodes pages - no network.
//   npx tsx scripts/airline-lookup-selftest.ts
import assert from "node:assert/strict";
import {
  avcodesLogoUrl,
  avcodesSearchBody,
  htmlToPlainText,
  normalizeAirlineCode,
  parseAvcodesResult,
} from "../lib/airline-lookup";

// ── normalizeAirlineCode ─────────────────────────────────────────────────────
assert.equal(normalizeAirlineCode("IZ"), "IZ");
assert.equal(normalizeAirlineCode("iz"), "IZ", "lower case is upper-cased");
assert.equal(normalizeAirlineCode(" IZ "), "IZ", "spaces around the code are dropped (29.10: ' IZ' failed)");
assert.equal(normalizeAirlineCode("IZ\t\n"), "IZ", "a tab or line break from a copied cell");
assert.equal(normalizeAirlineCode("IZ‏"), "IZ", "a right-to-left mark");
assert.equal(normalizeAirlineCode("​LY "), "LY", "a zero-width space and a no-break space");
assert.equal(normalizeAirlineCode("w6"), "W6", "letter + digit");
assert.equal(normalizeAirlineCode("7x"), "7X", "digit + letter");
assert.equal(normalizeAirlineCode(""), null);
assert.equal(normalizeAirlineCode("   "), null);
assert.equal(normalizeAirlineCode("I"), null, "one character");
assert.equal(normalizeAirlineCode("IZ513"), null, "a flight number is not an airline code");
assert.equal(normalizeAirlineCode("ELY"), null, "an ICAO code is not the IATA field");
assert.equal(normalizeAirlineCode("I Z"), null, "a space inside the code");
assert.equal(normalizeAirlineCode("א ב"), null);
assert.equal(normalizeAirlineCode(undefined), null);
assert.equal(normalizeAirlineCode(42), null);

// ── avcodesSearchBody / avcodesLogoUrl ───────────────────────────────────────
assert.equal(
  avcodesSearchBody("IZ"),
  "iataairl=IZ&icaoairl=&faacode=&account=&prefix=&airlname=&callsign=&B1=",
  "the site's own form fields, in its order",
);
assert.equal(avcodesLogoUrl("AIZ"), "https://www.avcodes.co.uk/images/logos/AIZ.png");

// ── htmlToPlainText ──────────────────────────────────────────────────────────
assert.equal(htmlToPlainText("<p>IATA Code:&nbsp;IZ</p>"), "IATA Code: IZ");
assert.equal(htmlToPlainText("A&amp;B &#39;x&#39; &#x41;"), "A&B 'x' A");
assert.equal(htmlToPlainText("<script>var s = '<b>x</b>';</script><style>p{}</style>ok"), "ok");

// ── parseAvcodesResult ───────────────────────────────────────────────────────
const page = (body: string) => `<!doctype html><html><head>
<style>.navbar .nav-item .dropdown-menu{ display: none; }</style>
<script>var marker = "This is Current Data";</script>
</head><body><nav>Avcodes Airline Codes Airport Codes</nav>
<h2>Database Search Result</h2>${body}
<p>* = Controlled duplicate</p><a href="airlcodesearch.asp">SEARCH AGAIN</a>
<footer>&copy; 2007&ndash;2026 Aviation Codes Central</footer></body></html>`;

const record = (heading: string, name: string, full: string, iata: string, icao: string) => `
<div class="card"><h5>${heading}</h5><h4>${name}</h4>
<table><tr><td>Full Name:</td><td>${full}</td></tr>
<tr><td>IATA Code:</td><td>&nbsp;${iata}</td></tr>
<tr><td>ICAO Code:</td><td>&nbsp;${icao}</td></tr>
<tr><td>FAA 3LD Code:</td><td>&nbsp;</td></tr>
<tr><td>IATA Accounting Code:</td><td>&nbsp;238</td></tr>
<tr><td>ICAO Callsign:</td><td>&nbsp;Arkia</td></tr></table></div>`;

// IZ on 29.10: two records, the current one first, the historical one after it.
const arkia = page(`<p>Number of Records found 2</p>
${record("This is Current Data", "Arkia Israeli Airlines", "Arkia Israeli Airlines Ltd.", "IZ", "AIZ")}
${record("Please Note this is Historical Data", "Arkia", "Arkia Israel Inland Airlines", "IZ", "XYZ")}`);
assert.deepEqual(parseAvcodesResult(arkia), {
  kind: "found",
  airlineName: "Arkia Israeli Airlines",
  icaoCode: "AIZ",
  airlineLogo: "https://www.avcodes.co.uk/images/logos/AIZ.png",
});

// The historical record first, the current one after it: the current one still wins.
const reordered = page(`<p>Number of Records found 2</p>
${record("Please Note this is Historical Data", "Old Name", "Old Name Ltd.", "LY", "OLD")}
${record("This is Current Data", "EL AL", "EL AL Israel Airlines Ltd. d/b/a El Al", "LY", "ELY")}`);
const elal = parseAvcodesResult(reordered);
assert.equal(elal.kind, "found");
assert.equal(elal.kind === "found" && elal.airlineName, "EL AL");
assert.equal(elal.kind === "found" && elal.icaoCode, "ELY");

// A name the old ASCII-only pattern refused.
const accented = parseAvcodesResult(page(`<p>Number of Records found 1</p>
${record("This is Current Data", "Société Air Tahiti Nui", "Air Tahiti Nui", "TN", "THT")}`));
assert.equal(accented.kind === "found" && accented.airlineName, "Société Air Tahiti Nui");

// ZZ / 7X on 29.10.
assert.deepEqual(
  parseAvcodesResult(page(`<p>Number of Records found 0</p><p>No results found for IATA Code : ZZ</p>`)),
  { kind: "not_found" },
);

// Only a historical record: the code is no longer an airline's.
assert.deepEqual(
  parseAvcodesResult(page(`<p>Number of Records found 1</p>
${record("Please Note this is Historical Data", "Gone Air", "Gone Air Ltd.", "QQ", "GON")}`)),
  { kind: "historical_only" },
);

// A current airline with an empty ICAO cell: "ICAO Code: FAA 3LD Code:" must not read as "FAA".
assert.deepEqual(
  parseAvcodesResult(page(`<p>Number of Records found 1</p>
${record("This is Current Data", "Tiny Air", "Tiny Air Ltd.", "T1", "")}`)),
  { kind: "no_icao", airlineName: "Tiny Air" },
);

// A page that is not the result page: an error page, or the site changed its layout.
assert.equal(parseAvcodesResult("<html><body>Service Unavailable</body></html>").kind, "unreadable");
assert.equal(parseAvcodesResult("").kind, "unreadable");
assert.equal(
  parseAvcodesResult(page(`<p>Number of Records found 1</p><div>Airline: Arkia</div>`)).kind,
  "unreadable",
  "records found but no current / historical section",
);
assert.equal(
  parseAvcodesResult(page(`<p>Number of Records found 1</p><h5>This is Current Data</h5><p>ICAO Code: AIZ</p>`)).kind,
  "unreadable",
  "a current section with no name before Full Name: / IATA Code:",
);

console.log("airline-lookup selftest: all passed");
