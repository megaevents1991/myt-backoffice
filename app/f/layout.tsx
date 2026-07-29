import { Heebo } from "next/font/google";

/**
 * Public form pages get their own type.
 *
 * Heebo is one of the few families with genuine Hebrew and Latin parity, so a
 * bilingual form keeps the same voice when it flips to RTL instead of swapping
 * personality mid-form. Weight does the expressive work: 900 for display
 * against 400 for body.
 */
const heebo = Heebo({
  subsets: ["latin", "hebrew"],
  weight: ["400", "500", "700", "800", "900"],
  display: "swap",
});

export default function PublicFormLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={heebo.className}>{children}</div>;
}
