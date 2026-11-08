import { bidiVisual } from "@/components/creative/MatchTemplate";
import { fitBox, type LogoImage } from "@/lib/creative/logo";

/**
 * The branded Meta picture of a TOUR (mega-family docs/plans/PRODUCT-FEED-PLAN.md): the tour's own photo, the company's
 * logo, the tour's name, where it goes, what the price holds, its date and the price as the site's card prints it
 * ("החל מ-1,555$ לאדם", the card's note under it, the price before a discount struck through). Every word comes from
 * the site's tours report - nothing is invented here. Rendered by lib/creative/render.tsx renderTourCreativePng.
 *
 * The logo is the tour's WORLD's (Dor, 08.11: "לפי עולמות - מגה איבנטס, מגה פמילי"; backoffice Categories & Tags >
 * Worlds > Logo), and the group's "מגה תיירות" sits small in the top-right corner, so the brand house shows; a tour
 * of no world (or a world without a logo) carries the group's logo alone, in the middle. A logo on white (a JPEG -
 * Mega Family's swoosh) is drawn as a rounded badge; light letters on a clear background sit on the photo.
 *
 * Satori: flex only, no BiDi (Hebrew goes through bidiVisual), no objectPosition. The 4:5 picture keeps everything
 * that must survive Meta's square crop inside SAFE_INSET from the top and bottom, as MatchTemplate does.
 */
export type TourCreativeInput = {
  name: string;
  places: string;
  includesText: string;
  dateText: string;
  datesCount: number;
  priceText: string;
  priceRegularText: string;
  priceNote: string;
  onSale: boolean;
  /** The tour's photo, absolute. */
  image: string;
  /** The company's logo (white), absolute. */
  logo: string;
  /** The world's colours; "" = the group's purple. */
  color: string;
  colorDeep: string;
  /** The tour's world's logo, absolute ("" = none). */
  worldLogo?: string;
};

/** The two logos as lib/creative/render.tsx loaded them (null = not drawn). */
export type TourLogos = { world: LogoImage | null; group: LogoImage | null };

function Logo({ img, maxW, maxH, radius }: { img: LogoImage; maxW: number; maxH: number; radius: number }) {
  const box = fitBox(img, maxW, maxH);
  const badge = img.format === "jpeg";
  return (
    // (Satori draws boxShadow "none" as a black box at the origin: a plain logo gets no shadow key at all)
    <div style={{ display: "flex", width: box.width, height: box.height, ...(badge ? { borderRadius: radius, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" } : {}) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.src} width={box.width} height={box.height} alt="" />
    </div>
  );
}

const SAFE_INSET = 148;
const GROUP = "#6E34B1";
const GROUP_DEEP = "#2A1640";
const INK = "#FFFFFF";

/** "#aabbcc" (a "#abc" is spread out) -> the same, else the fallback. The gradients add an alpha pair to it. */
function hex(v: string, fallback: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

/** A font size that keeps a line on one line, from the number of letters (MatchTemplate's fitOneLine). */
function fit(text: string, max: number, width: number, min: number): number {
  const est = Math.floor(width / (Math.max(1, [...text].length) * 0.52));
  return Math.min(max, Math.max(min, est));
}

export function TourTemplate(props: TourCreativeInput & { width: number; height: number; logos: TourLogos }) {
  const { width, height } = props;
  const portrait = height > width;
  const brand = hex(props.color, GROUP);
  const deep = hex(props.colorDeep, GROUP_DEEP);
  const dates = props.dateText ? `יציאה ${props.dateText}` + (props.datesCount > 1 ? ` · ועוד ${props.datesCount - 1} מועדים` : "") : "";
  const price = props.priceText ? `החל מ-${props.priceText} לאדם` : "";
  const s = portrait ? 1 : 0.5;

  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", backgroundColor: deep, fontFamily: "brand", color: INK }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.image} width={width} height={height} alt="" style={{ position: "absolute", left: 0, top: 0, width, height, objectFit: "cover" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width, height: Math.round(height * 0.3), display: "flex", background: `linear-gradient(180deg, ${deep}E6 0%, ${deep}00 100%)` }} />
      <div style={{ position: "absolute", left: 0, top: Math.round(height * 0.42), width, height: Math.round(height * 0.58), display: "flex", background: `linear-gradient(0deg, ${deep}FA 0%, ${deep}C0 55%, ${deep}00 100%)` }} />

      {/* the world's logo in the middle (the group's when the tour has none), the group's small in the top-right corner */}
      <div style={{ display: "flex", justifyContent: "center", paddingTop: portrait ? SAFE_INSET : 26 }}>
        {props.logos.world ? (
          <Logo img={props.logos.world} maxW={portrait ? 440 : 250} maxH={portrait ? 190 : 104} radius={portrait ? 22 : 12} />
        ) : props.logos.group ? (
          <Logo img={props.logos.group} maxW={portrait ? 360 : 200} maxH={portrait ? 99 : 55} radius={0} />
        ) : null}
      </div>
      {props.logos.world && props.logos.group ? (
        <div style={{ position: "absolute", top: portrait ? SAFE_INSET : 26, right: portrait ? 44 : 26, display: "flex" }}>
          <Logo img={props.logos.group} maxW={portrait ? 170 : 104} maxH={portrait ? 47 : 29} radius={0} />
        </div>
      ) : null}

      {/* the tour */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: portrait ? SAFE_INSET : 30, paddingLeft: 40, paddingRight: 40 }}>
        <div style={{ display: "flex", textAlign: "center", fontSize: fit(props.name, portrait ? 112 : 58, width - 80, portrait ? 60 : 34), fontWeight: 700, lineHeight: 1.1, textShadow: "0 4px 28px rgba(0,0,0,0.8)" }}>
          {bidiVisual(props.name)}
        </div>
        {props.places ? (
          <div style={{ display: "flex", marginTop: 12 * s + 4, fontSize: fit(props.places, portrait ? 50 : 26, width - 80, portrait ? 30 : 18), color: "rgba(255,255,255,0.9)" }}>{bidiVisual(props.places)}</div>
        ) : null}
        <div style={{ display: "flex", width: portrait ? 120 : 70, height: portrait ? 7 : 4, borderRadius: 4, backgroundColor: brand, marginTop: portrait ? 22 : 10, marginBottom: portrait ? 22 : 10 }} />
        {props.includesText ? <div style={{ display: "flex", fontSize: portrait ? 40 : 21, color: "rgba(255,255,255,0.92)" }}>{bidiVisual(props.includesText)}</div> : null}
        {dates ? <div style={{ display: "flex", marginTop: portrait ? 10 : 4, fontSize: portrait ? 40 : 21, color: "rgba(255,255,255,0.85)" }}>{bidiVisual(dates)}</div> : null}
        {price ? (
          // white, in the world's deep colour: a pill in the world's own colour vanished into its scrim when a world's two
          // colours are the same (Mega Family: blue and blue - Dor, 08.11: "white button")
          <div style={{ display: "flex", alignItems: "center", marginTop: portrait ? 26 : 12, padding: portrait ? "22px 64px" : "10px 34px", borderRadius: 999, backgroundColor: INK, color: deep, boxShadow: "0 10px 40px rgba(0,0,0,0.35)" }}>
            {/* visual order (RTL): the price first on the right, the old one struck through on its left */}
            {props.onSale && props.priceRegularText ? (
              <div style={{ display: "flex", fontSize: portrait ? 44 : 22, color: deep, opacity: 0.55, textDecoration: "line-through", marginRight: portrait ? 22 : 12 }}>{props.priceRegularText}</div>
            ) : null}
            <div style={{ display: "flex", fontSize: portrait ? 72 : 36, fontWeight: 700 }}>{bidiVisual(price)}</div>
          </div>
        ) : null}
        {price && props.priceNote ? <div style={{ display: "flex", marginTop: portrait ? 12 : 6, fontSize: portrait ? 32 : 17, color: "rgba(255,255,255,0.8)" }}>{bidiVisual(props.priceNote)}</div> : null}
      </div>
    </div>
  );
}
