import { getSession } from "@/lib/auth/guards";
import {
  getMyCommissionTerms,
  getPackageBuilderEvents,
} from "@/lib/actions/portal-package-actions";
import { SELLER_ROLES } from "@/types/auth.types";
import { PackageWizard } from "./package-wizard";

export const dynamic = "force-dynamic";
// The wizard's server actions proxy slow supplier searches through main
// (Amadeus ~30s, Ratehawk two-step, TixStock listings) - the default function
// window cuts them off mid-flight and the UI reads it as "doesn't work".
export const maxDuration = 60;

export default async function NewPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; tickets?: string }>;
}) {
  const session = await getSession();
  if (!session?.partner_code) return null;

  // `?tickets=1` comes from the dashboard's "כרטיסים בלבד" toggle: the agent
  // already said they only want a ticket, so the wizard must not walk them
  // through flight and hotel to get there (doc 2026-08-30, item 10).
  const { event: eventParam, tickets: ticketsParam } = await searchParams;
  const initialEventId = Number(eventParam);
  const [events, commissionTerms] = await Promise.all([
    getPackageBuilderEvents(),
    getMyCommissionTerms().catch(() => null),
  ]);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">בניית חבילה</h1>
        <p className="text-sm text-muted-foreground">
          בוחרים אירוע, כרטיסים, טיסה ומלון - בדיוק כמו שהלקוח רואה באתר -
          ומקבלים לינק שמנחית אותו ישר על החבילה המוכנה.
        </p>
      </div>
      <PackageWizard
        events={events}
        initialEventId={Number.isFinite(initialEventId) ? initialEventId : undefined}
        initialTicketsOnly={ticketsParam === "1"}
        commissionTerms={commissionTerms}
        isAgent={SELLER_ROLES.includes(session.role)}
      />
    </main>
  );
}
