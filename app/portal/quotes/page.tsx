import { getSession } from "@/lib/auth/guards";
import { getPortalQuotes } from "@/lib/actions/quote-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { QuotesClient } from "./quotes-client";

export default async function PortalQuotesPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Quotes are an agent tool; an influencer only promotes a link.
  if (!isPartner || session.role !== "agent") return null;

  const quotes = await getPortalQuotes();

  return <QuotesClient initialQuotes={quotes} />;
}
