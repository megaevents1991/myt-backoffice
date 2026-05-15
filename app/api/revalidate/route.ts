import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Get the domains and secret from environment variables
    const hotelServiceUrl = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
    const parallelServiceUrl =
      process.env.NEXT_SECRET_PARALLEL_HOTEL_SERVICE_URL ||
      "https://mondial2026.mega-events.co.il";
    const revalidationSecret = process.env.NEXT_SECRET_REVALIDATION_SECRET;

    if (!hotelServiceUrl || !revalidationSecret) {
      return NextResponse.json(
        {
          error:
            "Missing required environment variables: NEXT_SECRET_HOTEL_SERVICE_URL or NEXT_SECRET_REVALIDATION_SECRET",
        },
        { status: 500 },
      );
    }

    const targets = [
      { name: "primary", baseUrl: hotelServiceUrl },
      { name: "parallel", baseUrl: parallelServiceUrl },
    ].filter(
      (target, index, allTargets) =>
        allTargets.findIndex(
          (candidate) => candidate.baseUrl === target.baseUrl,
        ) === index,
    );

    const revalidationResults = await Promise.allSettled(
      targets.map(async (target) => {
        const revalidationUrl = `${target.baseUrl.replace(/\/$/, "")}/api/revalidate?secret=${encodeURIComponent(
          revalidationSecret,
        )}`;
        const response = await fetch(revalidationUrl, {});
        const text = await response.text();
        let data: unknown = text;

        try {
          data = JSON.parse(text);
        } catch {
          // Keep raw text when response is not JSON.
        }

        if (!response.ok) {
          const errorMessage =
            typeof data === "object" && data !== null && "error" in data
              ? String((data as { error?: string }).error)
              : text;
          throw new Error(
            `${target.name} revalidation failed: ${response.status} ${errorMessage}`,
          );
        }

        return {
          target: target.name,
          url: target.baseUrl,
          data,
        };
      }),
    );

    const successes = revalidationResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<{
          target: string;
          url: string;
          data: unknown;
        }> => result.status === "fulfilled",
      )
      .map((result) => result.value);

    const failures = revalidationResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => ({
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      }));

    if (failures.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Revalidation failed for one or more targets",
          results: {
            successes,
            failures,
          },
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Pages revalidated successfully on all targets",
      data: successes,
    });
  } catch (error: any) {
    console.error("Revalidation error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to revalidate pages",
      },
      { status: 500 },
    );
  }
}
