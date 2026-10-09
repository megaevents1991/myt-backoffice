import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingClient } from "./marketing-client";

// "Sync now" (runMarketingSyncNow) runs the whole marketing sync - about 180 s measured -
// inside a server action of THIS route with a 240 s budget, so anything shorter would cut it
// off mid-sync and the UI would read it as "broken". Same as /price-light; mirrored in vercel.json.
export const maxDuration = 300;

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
