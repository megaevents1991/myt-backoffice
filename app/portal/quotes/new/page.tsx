import { getSession } from "@/lib/auth/guards";
import { getQuoteEvents, getMyAgentTerms } from "@/lib/actions/quote-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { QuoteForm } from "./quote-form";

export default async function NewPortalQuotePage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Quotes are an agent tool; an influencer only promotes a link.
  if (!isPartner || session.role !== "agent") return null;

  const [events, terms] = await Promise.all([
    getQuoteEvents(),
    getMyAgentTerms(),
  ]);

  return <QuoteForm events={events} terms={terms} />;
}
