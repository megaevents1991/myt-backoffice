// Satori has no BiDi algorithm — Hebrew renders in logical (i.e. reversed) order.
// Convert to visual order: split into strong-LTR runs (Latin/digits/currency) vs
// RTL-or-neutral runs, reverse the characters of RTL runs, then reverse run order.
const RTL_CHAR = /[֐-׿]/;
const LTR_CHAR = /[A-Za-z0-9€$₪]/; // Latin, digits, €, $, ₪

export function bidiVisual(text: string): string {
  if (!RTL_CHAR.test(text)) return text;
  const runs: { ltr: boolean; s: string }[] = [];
  for (const ch of text) {
    const ltr = LTR_CHAR.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr) last.s += ch;
    else runs.push({ ltr, s: ch });
  }
  return runs
    .reverse()
    .map((r) => (r.ltr ? r.s : [...r.s].reverse().join("")))
    .join("");
}

// ---------------------------------------------------------------------------
// Brand language — mirrors myt-main lib/og.tsx (dark canvas, neon palette,
// the site's real Figma blob shapes, MegaΣvents. wordmark).
// ---------------------------------------------------------------------------

const CANVAS = "#070618";
const INK = "#FAFAF5";
const MINT = "#5BFF95";
const AQUA = "#45E2FF";
const VIOLET = "#BBA1FF";
const GOLD = "#FACC15";

// Full brand neon palette (same order as the site's EVENT_ART_COLORS).
export const BLOB_HEX = [
  "#5BFF95", // mint
  "#45E2FF", // aqua
  "#BBA1FF", // violet
  "#FF4F61", // coral
  "#FACC15", // gold
  "#FF9D4D", // orange
] as const;

export const BLOB_SHAPES: { d: string; w: number; h: number }[] = [
  {
    d: "M376.567 312.293L311.733 247.245L360.413 239.179C395.964 233.277 409.983 189.739 384.522 164.305L331.689 111.226L370.84 104.771C398.3 100.259 409.156 66.545 389.487 46.8578L338.009 -4.75832C316.883 -25.942 286.807 -35.6261 257.394 -30.7155L185.469 -18.8338C158.009 -14.3216 147.154 19.3922 166.822 39.0795L194.851 67.1655L120.973 79.4455C85.4226 85.3477 71.4037 128.886 96.8645 154.319L133.914 191.587L46.4259 206.105C1.962 213.474 -15.5866 267.975 16.2236 299.904L99.5124 383.449C133.647 417.724 182.326 433.398 230.047 425.48L346.435 406.228C390.829 398.722 408.377 344.222 376.567 312.293Z",
    w: 400,
    h: 358,
  },
  {
    d: "M311.49 43.3357C307.568 14.9081 259.771 22.7798 196.776 58.596C179.306 -13.6957 151.603 -55.2606 127.922 -38.2394C104.241 -21.2181 91.9314 49.1704 95.8559 131.198C35.6311 184.076 -5.24942 239.816 -1.34339 268.128C2.57858 296.556 50.3756 288.684 113.371 252.868C130.86 321.145 157.627 359.699 180.55 343.223C203.473 326.746 215.732 260.141 212.981 181.334C273.956 128.235 315.428 71.8789 311.49 43.3357Z",
    w: 311,
    h: 311,
  },
  {
    d: "M414.973 186.331C410.064 153.061 341.982 130.658 251.657 128.637C228.526 39.1825 190.141 -23.6711 156.104 -20.5852C122.066 -17.4994 102.938 50.637 106.6 141.856C19.8136 160.072 -39.5599 193.893 -34.6713 227.028C-29.7628 260.298 38.3197 282.701 128.644 284.723C151.896 369.849 189.021 428.842 221.97 425.855C254.918 422.868 273.886 358.789 271.815 271.811C359.673 253.841 419.901 219.737 414.973 186.331Z",
    w: 315,
    h: 315,
  },
];

const TAGLINE = "טיסות · מלון · כרטיסים — חבילה אחת";

// The site's category photo backgrounds (same assets og.tsx uses, served from
// prod so satori can fetch them from anywhere).
export const PHOTO_BG = {
  football: "https://www.mega-events.co.il/art-backgrounds/football.jpg",
  tennis: "https://www.mega-events.co.il/art-backgrounds/tennis.jpg",
  cars: "https://www.mega-events.co.il/art-backgrounds/cars.jpg",
} as const;
export type CardBgKind = "blob" | keyof typeof PHOTO_BG;

export type CreativeInput = {
  // "match" = two blob cards + VS; "artist" = single centered blob card;
  // "photo" = full-bleed cropped panel, for events with no matched team/artist
  // logo — uses the event's own (regular, non-cutout) photo as the subject.
  kind: "match" | "artist" | "photo";
  homeLogoUrl: string;       // match: home logo; artist: artist image; photo: event photo
  homeName: string;          // match: home name; artist: artist name; photo: event name
  awayLogoUrl?: string;      // match only
  awayName?: string;         // match only
  dateText: string;          // "14.09.2026"
  timeText: string | null;   // "21:00" or null → omitted
  locationText: string;      // "Santiago Bernabéu, Madrid"
  priceText: string;         // "החל מ-€499" / "כרטיסים החל מ-€99"
  // Design-base mode: render the full branded canvas (glows, wordmark, names,
  // date/price) but WITHOUT blob cards and subject images — a background the
  // designer drops a not-yet-cut photo onto.
  bare?: boolean;
  // Card background: brand blob (default for artists) or a category photo
  // (default "football" for matches). Designer-overridable.
  bgKind?: CardBgKind;
  // Blob color/shape overrides (brand palette index 0-5 / shape 0-2).
  // null/undefined = the template's defaults per card.
  colorIndex?: number | null;
  shapeIndex?: number | null;
  // Designer sizing controls, all neutral by default. Scales are 0.5–2 (1 =
  // 100%); offsets are % of the card the image sits in (X+ = right, Y+ = down).
  // Match mode applies the same transform to both sides.
  imgScale?: number | null;
  imgOffsetX?: number | null;
  imgOffsetY?: number | null;
  bgScale?: number | null;
};

export function buildPriceText(mode: "package" | "ticket", price: number, currency: string): string {
  return mode === "ticket" ? `כרטיסים החל מ-${currency}${price}` : `חבילות החל מ-${currency}${price}`;
}

// Deterministic string → positive int (same technique as render.tsx's blob
// seed) — used to pick a stable-per-subject, varied-across-subjects
// color/shape when the designer hasn't explicitly overridden either.
function hashSeed(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// One site-style card: dark rounded card, brand blob (or a category photo)
// covering it, image on top.
function BlobCard({
  img, color, shapeIndex, w, h, radius, photoUrl,
  imgScale = 1, imgOffsetX = 0, imgOffsetY = 0, bgScale = 1,
}: {
  img: string;
  color: string;
  shapeIndex: number;
  w: number;
  h: number;
  radius: number;
  photoUrl?: string | null;
  imgScale?: number;
  imgOffsetX?: number;
  imgOffsetY?: number;
  bgScale?: number;
}) {
  const shape = BLOB_SHAPES[shapeIndex % BLOB_SHAPES.length];
  // bgScale folds into the cover factor so blob stays centered while zooming.
  const cover = Math.max(w / shape.w, h / shape.h) * 1.05 * bgScale;
  const bw = Math.round(shape.w * cover);
  const bh = Math.round(shape.h * cover);
  // Subject image: scaled dimensions + px offsets (satori-safe, no transform).
  const iw = Math.round((w - 24) * imgScale);
  const ih = Math.round((h - 40) * imgScale);
  const ox = Math.round((imgOffsetX / 100) * w);
  const oy = Math.round((imgOffsetY / 100) * h);
  const pw = Math.round(w * bgScale);
  const ph = Math.round(h * bgScale);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        width: w,
        height: h,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: "#0D0C1E",
        position: "relative",
        boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
      }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          width={pw}
          height={ph}
          alt=""
          style={{ position: "absolute", top: (h - ph) / 2, left: (w - pw) / 2, width: pw, height: ph, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: (h - bh) / 2,
            left: (w - bw) / 2,
            width: bw,
            height: bh,
          }}
        >
          <svg width={bw} height={bh} viewBox={`0 0 ${shape.w} ${shape.h}`}>
            <path d={shape.d} fill={color} />
          </svg>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        width={iw}
        height={ih}
        alt=""
        style={{ width: iw, height: ih, objectFit: "contain", position: "relative", left: ox, top: oy }}
      />
    </div>
  );
}

export function MatchTemplate({
  kind, homeLogoUrl, awayLogoUrl, homeName, awayName,
  dateText, timeText, locationText, priceText, bare,
  bgKind, colorIndex, shapeIndex,
  imgScale, imgOffsetX, imgOffsetY, bgScale,
  width, height, bgUrl,
}: CreativeInput & { width: number; height: number; bgUrl: string }) {
  const isSquare = height > 700;
  void bgUrl; // brand gradient canvas replaced the static background asset

  // Designer sizing controls — neutral unless overridden.
  const iScale = imgScale ?? 1;
  const iOffX = imgOffsetX ?? 0;
  const iOffY = imgOffsetY ?? 0;
  const bScale = bgScale ?? 1;
  const sizing = {
    imgScale: iScale,
    imgOffsetX: iOffX,
    imgOffsetY: iOffY,
    bgScale: bScale,
  };

  const cardW = kind === "artist" ? (isSquare ? 520 : 330) : isSquare ? 380 : 250;
  const cardH = kind === "artist" ? (isSquare ? 560 : 380) : isSquare ? 440 : 300;
  // Wide stadium panel (photo-bg match mode): one panel, both logos inside.
  const panelW = width - 2 * (isSquare ? 56 : 48);
  const panelH = isSquare ? 560 : 340;
  const panelLogo = isSquare ? 290 : 185;

  // Card background: explicit choice wins; default = football photo for
  // matches, brand blob for artists.
  const effectiveBg: CardBgKind = bgKind ?? (kind === "match" ? "football" : "blob");
  const photoUrl = effectiveBg !== "blob" ? PHOTO_BG[effectiveBg] : null;
  // Color/shape: explicit override wins; otherwise seeded from the subject's
  // own identity (same hash shape as renderBlobPng) so auto-generated
  // creatives (cron + "auto" in the manual designer) get real variety instead
  // of every single one landing on the same fixed mint/aqua/violet + shape.
  // Stable across re-renders of the SAME event (deterministic on its name +
  // date), varied ACROSS different events.
  const seed = hashSeed(
    kind === "match" ? `${homeName}|${awayName ?? ""}|${dateText}` : `${homeName}|${dateText}`,
  );
  const seedColor = seed % BLOB_HEX.length;
  // Unsigned shift — seed can exceed 2^31-1 (still valid from >>>0 in
  // hashSeed); a signed `>>` would ToInt32 that negative and produce a
  // negative shape index (undefined.d crash in BlobCard's <path>).
  const seedShape = (seed >>> 3) % BLOB_SHAPES.length;
  // Away card gets the next palette entry/shape so the two sides never come
  // out identical (matches the explicit-override behavior below).
  const homeColor = colorIndex != null ? BLOB_HEX[colorIndex % BLOB_HEX.length] : BLOB_HEX[seedColor];
  const awayColor =
    colorIndex != null ? BLOB_HEX[(colorIndex + 1) % BLOB_HEX.length] : BLOB_HEX[(seedColor + 1) % BLOB_HEX.length];
  const artistColor = colorIndex != null ? BLOB_HEX[colorIndex % BLOB_HEX.length] : BLOB_HEX[seedColor];
  const homeShape = shapeIndex != null ? shapeIndex % BLOB_SHAPES.length : seedShape;
  const awayShape =
    shapeIndex != null ? (shapeIndex + 1) % BLOB_SHAPES.length : (seedShape + 1) % BLOB_SHAPES.length;
  const artistShape = shapeIndex != null ? shapeIndex % BLOB_SHAPES.length : seedShape;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: CANVAS,
        fontFamily: "brand",
        color: INK,
      }}
    >
      {/* neon glows */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          background: `radial-gradient(${Math.round(width * 0.55)}px ${Math.round(height * 0.5)}px at 22% 40%, ${AQUA}33, transparent 70%)`,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          background: `radial-gradient(${Math.round(width * 0.55)}px ${Math.round(height * 0.5)}px at 78% 45%, ${MINT}33, transparent 70%)`,
          display: "flex",
        }}
      />

      {/* header: wordmark + tagline */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: isSquare ? 44 : 22 }}>
        <div style={{ display: "flex", fontSize: isSquare ? 52 : 38, fontWeight: 700, color: MINT }}>
          MegaΣvents.
        </div>
        <div style={{ display: "flex", fontSize: isSquare ? 24 : 17, color: "rgba(250,250,245,0.72)", marginTop: 6 }}>
          {bidiVisual(TAGLINE)}
        </div>
      </div>

      {/* main */}
      {kind === "artist" ? (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {bare ? (
            <div style={{ display: "flex", width: cardW, height: cardH }} />
          ) : (
            <BlobCard img={homeLogoUrl} color={artistColor} shapeIndex={artistShape} w={cardW} h={cardH} radius={isSquare ? 76 : 54} photoUrl={photoUrl} {...sizing} />
          )}
          <div style={{ display: "flex", fontSize: isSquare ? 58 : 38, fontWeight: 700, marginTop: isSquare ? 24 : 12, textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>
            {bidiVisual(homeName)}
          </div>
        </div>
      ) : kind === "photo" ? (
        /* fallback for events with no matched team/artist logo: the event's
           own regular photo, full-bleed cropped into one wide panel — no
           transparent cutout required (unlike the blob-card modes above). */
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: `0 ${isSquare ? 56 : 48}px` }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              width: panelW,
              height: panelH,
              borderRadius: isSquare ? 56 : 40,
              overflow: "hidden",
              position: "relative",
              backgroundColor: "#0D0C1E",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={homeLogoUrl}
              width={Math.round(panelW * bScale)}
              height={Math.round(panelH * bScale)}
              alt=""
              style={{
                position: "absolute",
                top: Math.round((panelH - panelH * bScale) / 2),
                left: Math.round((panelW - panelW * bScale) / 2),
                width: Math.round(panelW * bScale),
                height: Math.round(panelH * bScale),
                objectFit: "cover",
              }}
            />
            {/* dark gradient so the name stays legible over any photo */}
            <div
              style={{
                display: "flex",
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: Math.round(panelH * 0.55),
                background: "linear-gradient(to top, rgba(7,6,24,0.92), rgba(7,6,24,0))",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", padding: isSquare ? "0 40px 40px" : "0 30px 26px" }}>
              <div style={{ display: "flex", fontSize: isSquare ? 54 : 34, fontWeight: 700, textAlign: "center", textShadow: "0 2px 14px rgba(0,0,0,0.9)" }}>
                {bidiVisual(homeName)}
              </div>
            </div>
          </div>
        </div>
      ) : photoUrl && !bare ? (
        /* photo background: ONE wide stadium panel holding both logos + VS */
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: `0 ${isSquare ? 56 : 48}px` }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: panelW,
              height: panelH,
              borderRadius: isSquare ? 56 : 40,
              overflow: "hidden",
              position: "relative",
              backgroundColor: "#0D0C1E",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
              padding: `0 ${isSquare ? 56 : 44}px`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              width={Math.round(panelW * bScale)}
              height={Math.round(panelH * bScale)}
              alt=""
              style={{
                position: "absolute",
                top: Math.round((panelH - panelH * bScale) / 2),
                left: Math.round((panelW - panelW * bScale) / 2),
                width: Math.round(panelW * bScale),
                height: Math.round(panelH * bScale),
                objectFit: "cover",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={awayLogoUrl ?? ""} alt="" style={{ width: Math.round(panelLogo * iScale), height: Math.round(panelLogo * iScale), objectFit: "contain", position: "relative", left: Math.round((iOffX / 100) * panelLogo), top: Math.round((iOffY / 100) * panelLogo) }} />
              <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 10px rgba(0,0,0,0.9)" }}>
                {bidiVisual(awayName ?? "")}
              </div>
            </div>
            <div style={{ display: "flex", fontSize: isSquare ? 108 : 66, fontWeight: 700, color: INK, textShadow: `0 0 40px ${MINT}99, 0 4px 14px rgba(0,0,0,0.9)`, position: "relative" }}>
              VS
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={homeLogoUrl} alt="" style={{ width: Math.round(panelLogo * iScale), height: Math.round(panelLogo * iScale), objectFit: "contain", position: "relative", left: Math.round((iOffX / 100) * panelLogo), top: Math.round((iOffY / 100) * panelLogo) }} />
              <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 10px rgba(0,0,0,0.9)" }}>
                {bidiVisual(homeName)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", padding: `0 ${isSquare ? 64 : 56}px` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW }}>
            {bare ? (
              <div style={{ display: "flex", width: cardW, height: cardH }} />
            ) : (
              <BlobCard img={awayLogoUrl ?? ""} color={awayColor} shapeIndex={awayShape} w={cardW} h={cardH} radius={36} {...sizing} />
            )}
            <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}>
              {bidiVisual(awayName ?? "")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: isSquare ? 108 : 66, fontWeight: 700, color: INK, textShadow: `0 0 40px ${MINT}99, 0 4px 14px rgba(0,0,0,0.8)` }}>
              VS
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW }}>
            {bare ? (
              <div style={{ display: "flex", width: cardW, height: cardH }} />
            ) : (
              <BlobCard img={homeLogoUrl} color={homeColor} shapeIndex={homeShape} w={cardW} h={cardH} radius={36} {...sizing} />
            )}
            <div style={{ display: "flex", fontSize: isSquare ? 38 : 25, fontWeight: 700, marginTop: 14, textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}>
              {bidiVisual(homeName)}
            </div>
          </div>
        </div>
      )}

      {/* footer: date/location + price pill */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: isSquare ? 48 : 22 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: isSquare ? 34 : 23, color: "rgba(250,250,245,0.88)" }}>
          <div style={{ display: "flex" }}>{timeText ? `${dateText} | ${timeText}` : dateText}</div>
          {locationText ? (
            <div style={{ display: "flex", marginLeft: 18 }}>{`· ${bidiVisual(locationText)}`}</div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: isSquare ? 20 : 10,
            padding: isSquare ? "14px 44px" : "8px 28px",
            borderRadius: 999,
            backgroundColor: GOLD,
            color: CANVAS,
            fontSize: isSquare ? 44 : 28,
            fontWeight: 700,
            boxShadow: `0 0 60px ${GOLD}55`,
          }}
        >
          {bidiVisual(priceText)}
        </div>
      </div>
    </div>
  );
}
