import { getSession } from "@/lib/auth/guards";
import { getQuoteEvents, getMyAgentTerms } from "@/lib/actions/quote-actions";
import { getMyPreparedPackages } from "@/lib/actions/portal-package-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { QuoteForm, type QuotePrefill } from "./quote-form";

export default async function NewPortalQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ package?: string }>;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Quotes are an agent tool; an influencer only promotes a link.
  if (!isPartner || session.role !== "agent") return null;

  const { package: packageParam } = await searchParams;

  const [events, terms] = await Promise.all([
    getQuoteEvents(),
    getMyAgentTerms(),
  ]);

  // "שלח הצעה ללקוח" on a prepared package lands here with ?package= — seed
  // the quote from that package and carry its coded order link for the PDF.
  let prefill: QuotePrefill | null = null;
  const packageId = Number(packageParam);
  if (Number.isFinite(packageId)) {
    const mine = await getMyPreparedPackages();
    const pkg = mine.find((p) => p.id === packageId);
    if (pkg) {
      const parts = [
        `ההצעה מבוססת על חבילה מוכנה: ${pkg.qty} × ${pkg.category}`.trim(),
        pkg.flight === "offline" && pkg.flight_summary
          ? `טיסה: ${pkg.flight_summary}`
          : pkg.flight === "none"
            ? "ללא טיסה"
            : "טיסה לבחירת הלקוח באתר",
        pkg.hotel === "offline" && pkg.hotel_summary
          ? `מלון: ${pkg.hotel_summary}`
          : pkg.hotel === "none"
            ? "ללא מלון"
            : "מלון לבחירת הלקוח באתר",
      ].filter(Boolean);
      prefill = {
        eventId: pkg.event_id,
        qty: pkg.qty,
        note: parts.join("\n"),
        paymentLink: pkg.link,
      };
    }
  }

  return <QuoteForm events={events} terms={terms} prefill={prefill} />;
}
