import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPETITOR_API_BASE_URL = process.env.NEXT_SECRET_COMPETITOR_PRICING_URL;
const REQUEST_TIMEOUT_MS = 90_000;

type Provider = "liveevents" | "issta";

type CompetitorPricingRequest = {
  provider?: Provider;
  eventName?: string;
  eventLocation?: string;
  eventDate?: string;
  travelDates?: {
    startDate?: string;
    endDate?: string;
  };
};

function isValidProvider(value: string | undefined): value is Provider {
  return value === "liveevents" || value === "issta";
}

function buildUpstreamPayload(
  body: Required<
    Pick<CompetitorPricingRequest, "provider" | "eventName" | "eventDate">
  > &
    Pick<CompetitorPricingRequest, "eventLocation" | "travelDates">,
) {
  if (body.provider === "liveevents") {
    return {
      eventName: body.eventName,
      eventLocation: body.eventLocation ?? "",
      eventDate: body.eventDate,
      ...(body.travelDates?.startDate || body.travelDates?.endDate
        ? {
            dates: {
              ...(body.travelDates?.startDate
                ? { start_date: body.travelDates.startDate }
                : {}),
              ...(body.travelDates?.endDate
                ? { end_date: body.travelDates.endDate }
                : {}),
            },
          }
        : {}),
    };
  }

  return {
    eventName: body.eventName,
    eventLocation: body.eventLocation ?? "",
    eventDate: body.eventDate,
  };
}

function getUpstreamPath(provider: Provider) {
  return provider === "liveevents" ? "/liveevents/quote" : "/issta/search";
}

export async function POST(request: NextRequest) {
  let body: CompetitorPricingRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidProvider(body.provider)) {
    return NextResponse.json(
      { error: "provider must be one of: liveevents, issta." },
      { status: 400 },
    );
  }

  if (!body.eventName?.trim()) {
    return NextResponse.json(
      { error: "eventName is required." },
      { status: 400 },
    );
  }

  if (!body.eventDate?.trim()) {
    return NextResponse.json(
      { error: "eventDate is required." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstreamUrl = `${COMPETITOR_API_BASE_URL}${getUpstreamPath(body.provider)}`;
    const upstreamPayload = buildUpstreamPayload({
      provider: body.provider,
      eventName: body.eventName.trim(),
      eventLocation: body.eventLocation?.trim(),
      eventDate: body.eventDate.trim(),
      travelDates: body.travelDates,
    });
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamPayload),
      cache: "no-store",
      signal: controller.signal,
    });

    const responseText = await upstreamResponse.text();
    let data: unknown = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }
    }

    return NextResponse.json(
      {
        provider: body.provider,
        upstreamStatus: upstreamResponse.status,
        data,
      },
      {
        status: upstreamResponse.ok ? 200 : upstreamResponse.status,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Competitor pricing request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown competitor pricing error.";

    return NextResponse.json(
      {
        provider: body.provider,
        error: message,
      },
      { status: 500 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
