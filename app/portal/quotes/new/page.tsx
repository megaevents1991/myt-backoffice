import { getSession } from "@/lib/auth/guards";
import { getQuoteEvents } from "@/lib/actions/quote-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { QuoteForm } from "./quote-form";

export default async function NewPortalQuotePage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (getQuoteEvents throws for non-agent/affiliate roles).
  if (!isPartner) return null;

  const events = await getQuoteEvents();

  return <QuoteForm events={events} />;
}
