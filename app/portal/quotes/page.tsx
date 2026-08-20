import { getSession } from "@/lib/auth/guards";
import { getPortalQuotesOverview } from "@/lib/actions/quote-actions";
import { PARTNER_ROLES, SELLER_ROLES } from "@/types/auth.types";
import { QuotesClient } from "./quotes-client";

export default async function PortalQuotesPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Quotes are a seller tool (agent/office_manager); an influencer only promotes a link.
  if (!isPartner || !SELLER_ROLES.includes(session.role)) return null;

  const { quotes, stats } = await getPortalQuotesOverview();

  return (
    <QuotesClient
      initialQuotes={quotes}
      stats={stats}
      isManager={session.role === "office_manager"}
    />
  );
}
