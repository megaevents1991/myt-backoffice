import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingClient } from "./marketing-client";

// "סנכרן עכשיו" (runMarketingSyncNow) runs the marketing sync with a 50s budget inside a
// server action of THIS route, so the platform default window would cut it off mid-sync and
// the UI would read it as "broken". Mirrored in vercel.json.
export const maxDuration = 60;

// Admin-only (lib/nav.ts roles: ADMIN_ROLES) - refused here too, server-side.
export default async function MarketingPage() {
  await requireAdmin();
  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title="Marketing"
        description="Spend from Meta and Google against the orders that were actually paid - revenue, supplier cost and profit per campaign; Instagram performance; alerts. Synced every six hours."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <MarketingClient />
      </Suspense>
    </div>
  );
}
