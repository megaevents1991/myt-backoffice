import { getSession } from "@/lib/auth/guards";
import { getPortalQuotesOverview } from "@/lib/actions/quote-actions";
import { getMyPreparedPackages } from "@/lib/actions/portal-package-actions";
import { PARTNER_ROLES, SELLER_ROLES } from "@/types/auth.types";
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default async function PortalQuotesPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Quotes are a seller tool (agent/office_manager); an influencer only promotes a link.
  if (!isPartner || !SELLER_ROLES.includes(session.role)) return null;

  // V2 merged table: quotes AND package links in one list.
  const [{ quotes, stats }, packages] = await Promise.all([
    getPortalQuotesOverview(),
    getMyPreparedPackages().catch((error: unknown) => {
      console.error("PortalQuotesPage packages:", error);
      return [];
    }),
  ]);

  return (
    <QuotesClient
      initialQuotes={quotes}
      stats={stats}
      packages={packages}
      isManager={session.role === "office_manager"}
    />
  );
}
