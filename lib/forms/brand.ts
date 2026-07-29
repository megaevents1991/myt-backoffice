/**
 * MYT brand language for the public form pages.
 *
 * Mirrors the palette and Figma blob shapes already used by the creative
 * generator (`components/creative/MatchTemplate.tsx`) and the site's OG images
 * (myt-main `lib/og.tsx`). Kept as its own small module so the public fill page
 * does not pull the whole creative-generator client component into its bundle.
 * If the brand palette changes, change it in all three places.
 */

/** Deep indigo, not black — the blue cast is the point. */
export const CANVAS = "#070618";
export const INK = "#FAFAF5";

export const BRAND_ACCENTS = [
  { value: "#5BFF95", name: "Mint" },
  { value: "#45E2FF", name: "Aqua" },
  { value: "#BBA1FF", name: "Violet" },
  { value: "#FF4F61", name: "Coral" },
  { value: "#FACC15", name: "Gold" },
  { value: "#FF9D4D", name: "Orange" },
] as const;

export const DEFAULT_ACCENT = BRAND_ACCENTS[0].value;

/** The site's real Figma blob shapes, used as the ambient glow. */
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

/** `#RRGGBB` → `r, g, b`, for building rgba() strings in inline styles. */
export function hexToRgb(hex: string): string {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Readable foreground for a solid accent fill.
 *
 * Every brand neon is light, so the submit button needs dark text on it. Uses
 * the WCAG relative-luminance threshold rather than eyeballing it, so a custom
 * accent still gets a legible label.
 */
export function onAccent(hex: string): string {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const channel = (start: number) => {
    const v = parseInt(clean.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? CANVAS : INK;
}
