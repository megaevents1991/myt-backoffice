import { type NextRequest, NextResponse } from "next/server";
import { renderCreativePng, SIZES, type CreativeSize } from "@/lib/creative/render";
import { buildCreativeInput, type CreativeParams } from "@/lib/creative/input";

// middleware.ts skips /api/* — auth enforced here via the session cookie.
export async function GET(req: NextRequest) {
  if (!req.cookies.get("session")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") === "artist" ? "artist" : "match";
  const dateText = q.get("date") ?? "";
  const price = Number(q.get("price"));
  const size = (q.get("size") ?? "square") as CreativeSize;
  const mode = q.get("mode") === "ticket" ? "ticket" : "package";

  const base = {
    dateText,
    timeText: q.get("time") || null,
    locationText: q.get("loc") ?? "",
    price,
    currency: q.get("cur") ?? "€",
    mode,
  } as const;

  let params: CreativeParams;
  if (kind === "artist") {
    const imageUrl = q.get("img") ?? "";
    const artistName = q.get("name") ?? "";
    if (!imageUrl || !artistName || !dateText || !price || !(size in SIZES)) {
      return NextResponse.json(
        { error: "Artist creative requires: img, name, date, price; optional: time, loc, cur, mode, size" },
        { status: 400 },
      );
    }
    params = { kind: "artist", imageUrl, artistName, ...base };
  } else {
    const homeId = Number(q.get("home"));
    const awayId = Number(q.get("away"));
    if (!homeId || !awayId || !dateText || !price || !(size in SIZES)) {
      return NextResponse.json(
        { error: "Match creative requires: home, away, date, price; optional: time, loc, cur, mode, size" },
        { status: 400 },
      );
    }
    params = { kind: "match", homeId, awayId, ...base };
  }

  try {
    const input = await buildCreativeInput(params);
    const png = await renderCreativePng(input, size);
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("creative render failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Render failed" },
      { status: 500 },
    );
  }
}
