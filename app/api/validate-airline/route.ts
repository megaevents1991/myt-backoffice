import { NextRequest, NextResponse } from "next/server";
import { normalizeAirlineCode, parseAvcodesResult } from "@/lib/airline-lookup";
import { fetchAvcodes } from "@/lib/services/airline-names";

const LOOKUP_DOWN = "The airline lookup (avcodes.co.uk) did not answer - try again in a minute";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const raw = body && typeof body === "object" ? (body as { airlineCode?: unknown }).airlineCode : undefined;
    const code = normalizeAirlineCode(raw);
    if (!code) {
      return NextResponse.json(
        { error: "Enter the two-character IATA airline code (e.g. LY, W6)" },
        { status: 400 }
      );
    }

    let html: string;
    try {
      html = await fetchAvcodes(code);
    } catch (error) {
      console.error(`Airline validation: avcodes did not answer for ${code}:`, error);
      return NextResponse.json({ error: LOOKUP_DOWN }, { status: 502 });
    }

    const result = parseAvcodesResult(html);
    switch (result.kind) {
      case "found":
        return NextResponse.json({
          success: true,
          airlineName: result.airlineName,
          airlineLogo: result.airlineLogo,
          icaoCode: result.icaoCode,
          iataCode: code,
        });
      case "not_found":
        return NextResponse.json({ error: `Airline code ${code} not found` }, { status: 404 });
      case "historical_only":
        return NextResponse.json(
          { error: `Airline code ${code} is no longer in use (avcodes holds only historical records)` },
          { status: 404 }
        );
      case "no_icao":
        return NextResponse.json(
          { error: `${result.airlineName} (${code}) has no ICAO code on avcodes, so there is no logo to use` },
          { status: 404 }
        );
      case "unreadable":
        console.error(`Airline validation: avcodes page for ${code} unreadable: ${result.reason}`);
        return NextResponse.json({ error: LOOKUP_DOWN }, { status: 502 });
    }
  } catch (error) {
    console.error("Airline validation error:", error);
    return NextResponse.json({ error: "Failed to validate airline code" }, { status: 500 });
  }
}
