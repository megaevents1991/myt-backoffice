import { bidiVisual } from "@/components/creative/MatchTemplate";
import { GROUP, GROUP_DEEP, INK, Logo, SAFE_INSET, fit, hex, type TourLogos } from "@/components/creative/TourTemplate";
import type { LogoImage } from "@/lib/creative/logo";

/**
 * The feed cover of a WORLD (mega-family lib/feed/tours-feed.ts feedWorlds; Dor 09.11.2026: a picture "in the same vibe"
 * for every world, first among its hero images, "and it can serve the product feed"): the world's first hero picture,
 * its logo (or its brand name in words when it has none), the group's "מגה תיירות" small in the corner, the world's
 * name and how many of its tours the feed carries. The picture over a Collection / catalog ad whose product set is the
 * world's tours (custom_label_0 = the world's key). Every word comes from the site's tours report.
 *
 * The worlds' pictures keep their people in the left third and the view on the right (the site's title box sits on the
 * right), so a crop narrower than the picture is centred at FOCUS_X of its width, not in the middle - Satori has no
 * objectPosition, so the picture is placed by hand from its measured size. Rendered by lib/creative/render.tsx
 * renderWorldCoverPng; drawn and stored by lib/creative/worlds.ts.
 */
export type WorldCoverInput = {
  /** The world's page name ("משפחות"). */
  name: string;
  /** "מגה פמילי". */
  brandName: string;
  /** Its tours in the feed. */
  tours: number;
  /** The world's first hero picture, absolute. */
  image: string;
  /** The company's logo (white), absolute. */
  logo: string;
  /** The world's own logo, absolute ("" = none). */
  worldLogo: string;
  color: string;
  colorDeep: string;
};

/** Where a crop narrower than the picture is centred, as a share of its width (the people stand in the left third). */
export const FOCUS_X = 0.36;

/** The picture's box inside a width x height frame: covers it, centred at FOCUS_X across and in the middle down. Pure. */
export function coverBox(img: { width: number; height: number }, width: number, height: number) {
  const scale = Math.max(width / img.width, height / img.height);
  const w = Math.ceil(img.width * scale);
  const h = Math.ceil(img.height * scale);
  const left = Math.round(Math.min(0, Math.max(width - w, width / 2 - w * FOCUS_X)));
  const top = Math.round((height - h) / 2);
  return { left, top, width: w, height: h };
}

/** "17 טיולים", "טיול אחד", "" for none. Pure. */
export function toursLine(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "טיול אחד" : `${n} טיולים`;
}

export function WorldCoverTemplate(props: WorldCoverInput & { width: number; height: number; logos: TourLogos; picture: LogoImage | null }) {
  const { width, height } = props;
  const portrait = height > width;
  const brand = hex(props.color, GROUP);
  const deep = hex(props.colorDeep, GROUP_DEEP);
  const box = props.picture ? coverBox(props.picture, width, height) : { left: 0, top: 0, width, height };
  // a world with its own logo says its name under it; one without says its brand name, and its name under that
  const title = props.logos.world ? props.name : props.brandName;
  const sub = props.logos.world ? "" : props.name;
  const count = toursLine(props.tours);

  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", backgroundColor: deep, fontFamily: "brand", color: INK }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={props.picture?.src || props.image}
        width={box.width}
        height={box.height}
        alt=""
        style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, ...(props.picture ? {} : { objectFit: "cover" as const }) }}
      />
      <div style={{ position: "absolute", left: 0, top: 0, width, height: Math.round(height * 0.3), display: "flex", background: `linear-gradient(180deg, ${deep}D9 0%, ${deep}00 100%)` }} />
      <div style={{ position: "absolute", left: 0, top: Math.round(height * 0.55), width, height: Math.round(height * 0.45), display: "flex", background: `linear-gradient(0deg, ${deep}F2 0%, ${deep}A6 50%, ${deep}00 100%)` }} />

      {/* the world's logo in the middle (the group's when the world has none), the group's small in the top-right corner */}
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

      {/* the world */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: portrait ? SAFE_INSET : 30, paddingLeft: 40, paddingRight: 40 }}>
        <div style={{ display: "flex", textAlign: "center", fontSize: fit(title, portrait ? 120 : 64, width - 80, portrait ? 64 : 36), fontWeight: 700, lineHeight: 1.1, textShadow: "0 4px 28px rgba(0,0,0,0.8)" }}>
          {bidiVisual(title)}
        </div>
        {sub ? (
          <div style={{ display: "flex", marginTop: portrait ? 12 : 6, fontSize: fit(sub, portrait ? 52 : 28, width - 80, portrait ? 30 : 18), color: "rgba(255,255,255,0.92)", textShadow: "0 2px 18px rgba(0,0,0,0.7)" }}>
            {bidiVisual(sub)}
          </div>
        ) : null}
        <div style={{ display: "flex", width: portrait ? 120 : 70, height: portrait ? 7 : 4, borderRadius: 4, backgroundColor: brand, marginTop: portrait ? 22 : 10, marginBottom: count ? (portrait ? 26 : 12) : 0 }} />
        {count ? (
          <div style={{ display: "flex", alignItems: "center", padding: portrait ? "20px 60px" : "9px 32px", borderRadius: 999, backgroundColor: INK, color: deep, boxShadow: "0 10px 40px rgba(0,0,0,0.35)", fontSize: portrait ? 56 : 30, fontWeight: 700 }}>
            {bidiVisual(count)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
