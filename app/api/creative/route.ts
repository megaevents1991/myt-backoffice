import { type NextRequest, NextResponse } from "next/server";
import {
  renderCreativePng,
  renderBlobPng,
  SIZES,
  type CreativeSize,
} from "@/lib/creative/render";
import { buildCreativeInput, type CreativeParams } from "@/lib/creative/input";

// middleware.ts skips /api/* — auth enforced here via the session cookie.
export async function GET(req: NextRequest) {
  if (!req.cookies.get("session")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;

  // Standalone transparent blob asset (design base for events without art).
  if (q.get("kind") === "blob") {
    const blobSize = (q.get("size") ?? "square") as CreativeSize;
    if (!(blobSize in SIZES)) {
      return NextResponse.json({ error: "Bad size" }, { status: 400 });
    }
    try {
      const png = await renderBlobPng(Number(q.get("seed")) || 0, blobSize);
      return new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="blob-${q.get("seed") ?? 0}.png"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      console.error("blob render failed:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Render failed" },
        { status: 500 },
      );
    }
  }

  const kind = q.get("kind") === "artist" ? "artist" : "match";
  const dateText = q.get("date") ?? "";
  const price = Number(q.get("price"));
  const size = (q.get("size") ?? "square") as CreativeSize;
  const mode = q.get("mode") === "ticket" ? "ticket" : "package";

  const bare = q.get("bare") === "1";
  const bgParam = q.get("bg");
  const bgKind =
    bgParam === "blob" || bgParam === "football" || bgParam === "tennis" || bgParam === "cars"
      ? bgParam
      : undefined;
  const colorParam = q.get("color");
  const shapeParam = q.get("shape");
  const base = {
    dateText,
    timeText: q.get("time") || null,
    locationText: q.get("loc") ?? "",
    price,
    currency: q.get("cur") ?? "€",
    mode,
    bare,
    bgKind,
    colorIndex: colorParam !== null && colorParam !== "" ? Number(colorParam) : null,
    shapeIndex: shapeParam !== null && shapeParam !== "" ? Number(shapeParam) : null,
  } as const;

  let params: CreativeParams;
  if (kind === "artist") {
    const imageUrl = q.get("img") ?? "";
    const artistName = q.get("name") ?? "";
    if ((!imageUrl && !bare) || !artistName || !dateText || !price || !(size in SIZES)) {
      return NextResponse.json(
        { error: "Artist creative requires: img (unless bare=1), name, date, price; optional: time, loc, cur, mode, size" },
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
