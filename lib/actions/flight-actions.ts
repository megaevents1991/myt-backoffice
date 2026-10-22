

export type PriceQuote = {
  price: number;
  /** Per-person market price before the margin (hotel: room ÷ 2). */
  raw: number;
  source: "direct" | "connection" | "hotel";
  /** One-line arithmetic from the service, e.g. "3★ room $345 ÷ 2 = $173/person + $120 → $290". */
  detail: string;
} | null;

/**
 * Quote a base price through the shared pricing rule (/api/price-quote):
 * flight = cheapest direct +$100 (connection when the gap > $300), hotel =
 * cheapest 3-star +$120, both rounded to tens. Null = nothing found / failed.
 */
export async function fetchPriceQuote(
  body:
    | { kind: "flight"; cityIata: string; departDate: string; returnDate: string }
    | { kind: "hotel"; lat: number; lon: number; checkin: string; checkout: string },
): Promise<PriceQuote> {
  try {
    const response = await fetch("/api/price-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.success) return null;
    return data.quote;
  } catch (error) {
    console.error("fetchPriceQuote failed:", error);
    return null;
  }
}

// Helper function to validate IATA codes
export function isValidIATACode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}
