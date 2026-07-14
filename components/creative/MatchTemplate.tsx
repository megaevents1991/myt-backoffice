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

const BLOB_SHAPES: { d: string; w: number; h: number }[] = [
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

export type CreativeInput = {
  // "match" = two blob cards + VS; "artist" = single centered blob card.
  kind: "match" | "artist";
  homeLogoUrl: string;       // match: home logo; artist: artist image
  homeName: string;          // match: home name; artist: artist name
  awayLogoUrl?: string;      // match only
  awayName?: string;         // match only
  dateText: string;          // "14.09.2026"
  timeText: string | null;   // "21:00" or null → omitted
  locationText: string;      // "Santiago Bernabéu, Madrid"
  priceText: string;         // "החל מ-€499" / "כרטיסים החל מ-€99"
};

export function buildPriceText(mode: "package" | "ticket", price: number, currency: string): string {
  return mode === "ticket" ? `כרטיסים החל מ-${currency}${price}` : `חבילות החל מ-${currency}${price}`;
}

// One site-style card: dark rounded card, brand blob covering it, image on top.
function BlobCard({
  img, color, shapeIndex, w, h, radius,
}: { img: string; color: string; shapeIndex: number; w: number; h: number; radius: number }) {
  const shape = BLOB_SHAPES[shapeIndex % BLOB_SHAPES.length];
  const cover = Math.max(w / shape.w, h / shape.h) * 1.05;
  const bw = Math.round(shape.w * cover);
  const bh = Math.round(shape.h * cover);
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        width={w - 24}
        height={h - 40}
        alt=""
        style={{ width: w - 24, height: h - 40, objectFit: "contain", position: "relative" }}
      />
    </div>
  );
}

export function MatchTemplate({
  kind, homeLogoUrl, awayLogoUrl, homeName, awayName,
  dateText, timeText, locationText, priceText,
  width, height, bgUrl,
}: CreativeInput & { width: number; height: number; bgUrl: string }) {
  const isSquare = height > 700;
  void bgUrl; // brand gradient canvas replaced the static background asset

  const cardW = kind === "artist" ? (isSquare ? 520 : 330) : isSquare ? 380 : 250;
  const cardH = kind === "artist" ? (isSquare ? 560 : 380) : isSquare ? 440 : 300;

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
          <BlobCard img={homeLogoUrl} color={VIOLET} shapeIndex={2} w={cardW} h={cardH} radius={44} />
          <div style={{ display: "flex", fontSize: isSquare ? 58 : 38, fontWeight: 700, marginTop: isSquare ? 24 : 12, textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>
            {bidiVisual(homeName)}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", padding: `0 ${isSquare ? 64 : 56}px` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW }}>
            <BlobCard img={awayLogoUrl ?? ""} color={AQUA} shapeIndex={1} w={cardW} h={cardH} radius={36} />
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
            <BlobCard img={homeLogoUrl} color={MINT} shapeIndex={0} w={cardW} h={cardH} radius={36} />
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
