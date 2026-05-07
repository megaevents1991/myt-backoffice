// City groups: airport codes that serve the same metropolitan area.
// Used to match flights and events when admins enter different IATA codes
// for the same city (e.g. event=MXP, flight=MIL — both Milan).
const CITY_GROUPS: string[][] = [
  ["MIL", "MXP", "LIN", "BGY"],                 // Milan
  ["LON", "LHR", "LGW", "STN", "LTN", "LCY", "SEN"], // London
  ["PAR", "CDG", "ORY", "BVA"],                 // Paris
  ["NYC", "JFK", "LGA", "EWR"],                 // New York
  ["TYO", "HND", "NRT"],                        // Tokyo
  ["ROM", "FCO", "CIA"],                        // Rome
  ["MOW", "SVO", "DME", "VKO"],                 // Moscow
  ["OSA", "KIX", "ITM"],                        // Osaka
  ["WAS", "IAD", "DCA", "BWI"],                 // Washington DC
  ["CHI", "ORD", "MDW"],                        // Chicago
  ["BUE", "EZE", "AEP"],                        // Buenos Aires
  ["RIO", "GIG", "SDU"],                        // Rio de Janeiro
  ["SAO", "GRU", "CGH", "VCP"],                 // São Paulo
  ["STO", "ARN", "BMA", "NYO", "VST"],          // Stockholm
  ["BJS", "PEK", "PKX"],                        // Beijing
  ["SHA", "PVG", "SHA"],                        // Shanghai
  ["SEL", "ICN", "GMP"],                        // Seoul
  ["TPE", "TPE", "TSA"],                        // Taipei
  ["IST", "IST", "SAW"],                        // Istanbul
  ["BUH", "OTP", "BBU"],                        // Bucharest
  ["BSL", "BSL", "MLH", "EAP"],                 // Basel/Mulhouse
  ["BHZ", "CNF", "PLU"],                        // Belo Horizonte
  ["DTT", "DTW", "YIP"],                        // Detroit
  ["HOU", "IAH", "HOU"],                        // Houston
  ["MIA", "MIA", "FLL"],                        // Miami area
  ["MTL", "YUL", "YMX"],                        // Montreal
  ["YTO", "YYZ", "YTZ"],                        // Toronto
];

const airportToGroup = new Map<string, Set<string>>();
for (const group of CITY_GROUPS) {
  const set = new Set(group);
  for (const code of group) {
    if (!airportToGroup.has(code)) airportToGroup.set(code, set);
  }
}

/**
 * Returns true when the two IATA codes refer to the same city
 * (either identical, or both in the same multi-airport group).
 * Empty strings return true (treated as "any").
 */
export function airportsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
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
