import localFont from "next/font/local";

/**
 * Public form pages get their own type.
 *
 * Heebo is one of the few families with genuine Hebrew and Latin parity, so a
 * bilingual form keeps the same voice when it flips to RTL instead of swapping
 * personality mid-form. Weight does the expressive work: 900 for display
 * against 400 for body.
 */
const heebo = localFont({
  src: [
    { path: "../fonts/heebo.woff2", weight: "400" },
    { path: "../fonts/heebo.woff2", weight: "500" },
    { path: "../fonts/heebo.woff2", weight: "700" },
    { path: "../fonts/heebo.woff2", weight: "800" },
    { path: "../fonts/heebo.woff2", weight: "900" },
  ],
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Heebo Fallback"],
});

export default function PublicFormLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={heebo.className}>{children}</div>;
}
