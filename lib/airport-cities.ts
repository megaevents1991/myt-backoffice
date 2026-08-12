// City groups: airport codes that serve the same metropolitan area.
// Used to match flights and events when admins enter different IATA codes
// for the same city (e.g. event=MXP, flight=MIL - both Milan).
const CITY_GROUPS: { name: string; codes: string[] }[] = [
  { name: "Milan", codes: ["MIL", "MXP", "LIN", "BGY"] },
  { name: "London", codes: ["LON", "LHR", "LGW", "STN", "LTN", "LCY", "SEN"] },
  { name: "Paris", codes: ["PAR", "CDG", "ORY", "BVA"] },
  { name: "New York", codes: ["NYC", "JFK", "LGA", "EWR"] },
  { name: "Tokyo", codes: ["TYO", "HND", "NRT"] },
  { name: "Rome", codes: ["ROM", "FCO", "CIA"] },
  { name: "Moscow", codes: ["MOW", "SVO", "DME", "VKO"] },
  { name: "Osaka", codes: ["OSA", "KIX", "ITM"] },
  { name: "Washington", codes: ["WAS", "IAD", "DCA", "BWI"] },
  { name: "Chicago", codes: ["CHI", "ORD", "MDW"] },
  { name: "Buenos Aires", codes: ["BUE", "EZE", "AEP"] },
  { name: "Rio de Janeiro", codes: ["RIO", "GIG", "SDU"] },
  { name: "Sao Paulo", codes: ["SAO", "GRU", "CGH", "VCP"] },
  { name: "Stockholm", codes: ["STO", "ARN", "BMA", "NYO", "VST"] },
  { name: "Beijing", codes: ["BJS", "PEK", "PKX"] },
  { name: "Shanghai", codes: ["SHA", "PVG"] },
  { name: "Seoul", codes: ["SEL", "ICN", "GMP"] },
  { name: "Taipei", codes: ["TPE", "TSA"] },
  { name: "Istanbul", codes: ["IST", "SAW"] },
  { name: "Bucharest", codes: ["BUH", "OTP", "BBU"] },
  { name: "Basel", codes: ["BSL", "MLH", "EAP"] },
  { name: "Belo Horizonte", codes: ["BHZ", "CNF", "PLU"] },
  { name: "Detroit", codes: ["DTT", "DTW", "YIP"] },
  { name: "Houston", codes: ["HOU", "IAH"] },
  { name: "Miami", codes: ["MIA", "FLL"] },
  { name: "Montreal", codes: ["MTL", "YUL", "YMX"] },
  { name: "Toronto", codes: ["YTO", "YYZ", "YTZ"] },
  // Single-airport cities - extend as needed
  { name: "Madrid", codes: ["MAD"] },
  { name: "Barcelona", codes: ["BCN"] },
  { name: "Lisbon", codes: ["LIS"] },
  { name: "Porto", codes: ["OPO"] },
  { name: "Berlin", codes: ["BER"] },
  { name: "Munich", codes: ["MUC"] },
  { name: "Frankfurt", codes: ["FRA"] },
  { name: "Hamburg", codes: ["HAM"] },
  { name: "Dusseldorf", codes: ["DUS"] },
  { name: "Cologne", codes: ["CGN"] },
  { name: "Vienna", codes: ["VIE"] },
  { name: "Zurich", codes: ["ZRH"] },
  { name: "Geneva", codes: ["GVA"] },
  { name: "Amsterdam", codes: ["AMS"] },
  { name: "Brussels", codes: ["BRU"] },
  { name: "Copenhagen", codes: ["CPH"] },
  { name: "Oslo", codes: ["OSL"] },
  { name: "Helsinki", codes: ["HEL"] },
  { name: "Dublin", codes: ["DUB"] },
  { name: "Edinburgh", codes: ["EDI"] },
  { name: "Manchester", codes: ["MAN"] },
  { name: "Birmingham", codes: ["BHX"] },
  { name: "Liverpool", codes: ["LPL"] },
  { name: "Glasgow", codes: ["GLA"] },
  { name: "Athens", codes: ["ATH"] },
  { name: "Thessaloniki", codes: ["SKG"] },
  { name: "Prague", codes: ["PRG"] },
  { name: "Warsaw", codes: ["WAW"] },
  { name: "Krakow", codes: ["KRK"] },
  { name: "Budapest", codes: ["BUD"] },
  { name: "Sofia", codes: ["SOF"] },
  { name: "Belgrade", codes: ["BEG"] },
  { name: "Zagreb", codes: ["ZAG"] },
  { name: "Ljubljana", codes: ["LJU"] },
  { name: "Bratislava", codes: ["BTS"] },
  { name: "Tallinn", codes: ["TLL"] },
  { name: "Riga", codes: ["RIX"] },
  { name: "Vilnius", codes: ["VNO"] },
  { name: "Naples", codes: ["NAP"] },
  { name: "Venice", codes: ["VCE"] },
  { name: "Florence", codes: ["FLR"] },
  { name: "Bologna", codes: ["BLQ"] },
  { name: "Turin", codes: ["TRN"] },
  { name: "Pisa", codes: ["PSA"] },
  { name: "Bari", codes: ["BRI"] },
  { name: "Catania", codes: ["CTA"] },
  { name: "Palermo", codes: ["PMO"] },
  { name: "Cagliari", codes: ["CAG"] },
  { name: "Genoa", codes: ["GOA"] },
  { name: "Verona", codes: ["VRN"] },
  { name: "Marseille", codes: ["MRS"] },
  { name: "Lyon", codes: ["LYS"] },
  { name: "Nice", codes: ["NCE"] },
  { name: "Toulouse", codes: ["TLS"] },
  { name: "Bordeaux", codes: ["BOD"] },
  { name: "Nantes", codes: ["NTE"] },
  { name: "Strasbourg", codes: ["SXB"] },
  { name: "Seville", codes: ["SVQ"] },
  { name: "Valencia", codes: ["VLC"] },
  { name: "Bilbao", codes: ["BIO"] },
  { name: "Malaga", codes: ["AGP"] },
  { name: "Palma de Mallorca", codes: ["PMI"] },
  { name: "Ibiza", codes: ["IBZ"] },
  { name: "Tenerife", codes: ["TFS", "TFN"] },
  { name: "Las Palmas", codes: ["LPA"] },
  { name: "Tel Aviv", codes: ["TLV"] },
  { name: "Eilat", codes: ["ETM", "VDA"] },
  { name: "Dubai", codes: ["DXB", "DWC"] },
  { name: "Abu Dhabi", codes: ["AUH"] },
  { name: "Doha", codes: ["DOH"] },
  { name: "Riyadh", codes: ["RUH"] },
  { name: "Jeddah", codes: ["JED"] },
  { name: "Cairo", codes: ["CAI"] },
  { name: "Cape Town", codes: ["CPT"] },
  { name: "Johannesburg", codes: ["JNB"] },
  { name: "Bangkok", codes: ["BKK", "DMK"] },
  { name: "Singapore", codes: ["SIN"] },
  { name: "Kuala Lumpur", codes: ["KUL"] },
  { name: "Hong Kong", codes: ["HKG"] },
  { name: "Manila", codes: ["MNL"] },
  { name: "Jakarta", codes: ["CGK", "HLP"] },
  { name: "Sydney", codes: ["SYD"] },
  { name: "Melbourne", codes: ["MEL"] },
  { name: "Brisbane", codes: ["BNE"] },
  { name: "Auckland", codes: ["AKL"] },
  { name: "Mumbai", codes: ["BOM"] },
  { name: "Delhi", codes: ["DEL"] },
  { name: "Bangalore", codes: ["BLR"] },
  { name: "Los Angeles", codes: ["LAX"] },
  { name: "San Francisco", codes: ["SFO", "OAK", "SJC"] },
  { name: "Seattle", codes: ["SEA"] },
  { name: "Boston", codes: ["BOS"] },
  { name: "Atlanta", codes: ["ATL"] },
  { name: "Dallas", codes: ["DFW", "DAL"] },
  { name: "Denver", codes: ["DEN"] },
  { name: "Phoenix", codes: ["PHX"] },
  { name: "Las Vegas", codes: ["LAS"] },
  { name: "Orlando", codes: ["MCO"] },
  { name: "Philadelphia", codes: ["PHL"] },
  { name: "Vancouver", codes: ["YVR"] },
  { name: "Mexico City", codes: ["MEX"] },
];

const airportToGroup = new Map<string, Set<string>>();
const cityNameToCodes = new Map<string, string[]>();
for (const group of CITY_GROUPS) {
  const set = new Set(group.codes);
  for (const code of group.codes) {
    if (!airportToGroup.has(code)) airportToGroup.set(code, set);
  }
  cityNameToCodes.set(normalizeCityName(group.name), group.codes);
}

function normalizeCityName(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Returns true when the two IATA codes refer to the same city
 * (either identical, or both in the same multi-airport group).
 * Empty strings return true (treated as "any").
 */
export function airportsMatch(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  const ga = airportToGroup.get(a);
  return ga?.has(b) ?? false;
}

/**
 * Returns the full set of IATA codes that share a city with the given code.
 * Falls back to just [code] if it isn't part of a known group.
 */
export function airportsInSameCity(code: string): string[] {
  const set = airportToGroup.get(code);
  if (set) return Array.from(set);
  return [code];
}

/**
 * Returns the IATA codes for a given city name.
 * Returns null when the city is not in the known mapping.
 */
export function airportsForCityName(
  name: string | undefined | null,
): string[] | null {
  if (!name) return null;
  return cityNameToCodes.get(normalizeCityName(name)) ?? null;
}
