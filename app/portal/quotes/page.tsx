import { getSession } from "@/lib/auth/guards";
import { getPortalQuotes } from "@/lib/actions/quote-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { QuotesClient } from "./quotes-client";

export default async function PortalQuotesPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (getPortalQuotes throws for non-agent/affiliate roles).
  if (!isPartner) return null;

  const quotes = await getPortalQuotes();

  return <QuotesClient initialQuotes={quotes} />;
}
