import { NextRequest, NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { errorMessage } from "@/lib/utils";

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL;
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

export async function GET(request: NextRequest) {
  // Staff only - until 05.10 this answered anyone on the internet, no session needed
  // (each call spends a live request on the supplier's API).
  const denied = await guardAdminRoute();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("event_id");

    if (!eventId) {
      return NextResponse.json(
        { success: false, error: "Missing event_id" },
        { status: 400 },
      );
    }

    if (!TIXSTOCK_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Server configuration error" },
        { status: 500 },
      );
    }

    const url = new URL(`${TIXSTOCK_API_URL}/tickets/feed`);
    url.searchParams.set("event_id", eventId);
    url.searchParams.set("per_page", "50");

    const allTickets: unknown[] = [];
    let currentPage = 1;
    let lastPage = 1;

    do {
      url.searchParams.set("page", String(currentPage));
      console.log(
        `Fetching TixStock tickets for event ${eventId}, page ${currentPage}...`,
      );

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${TIXSTOCK_TOKEN}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`TixStock API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();

      if (currentPage === 1) {
        lastPage = data.meta?.last_page ?? 1;
      }

      allTickets.push(...(data.data || []));
      currentPage++;
    } while (currentPage <= lastPage);

    console.log(
      `Fetched ${allTickets.length} tickets across ${lastPage} page(s) for event ${eventId}`,
    );

    return NextResponse.json({
      success: true,
      data: { data: allTickets },
    });
  } catch (error) {
    console.error("TixStock tickets fetch failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: errorMessage(error),
      },
      { status: 500 },
    );
  }
}
