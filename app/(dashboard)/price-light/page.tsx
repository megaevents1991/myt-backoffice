import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/auth/guards";
import { PriceLightClient } from "./price-light-client";

// The רמזור screen: what the competitors charge for the same event, and what
// to do about a red light. Spec docs/superpowers/specs/2026-09-09-price-light-design.md.
//
// "סרוק עכשיו" (triggerCrawl) runs a full Playwright crawl of one competitor site
// inside THIS route's function - the crawler's own budget is 240s, so the platform
// default window would cut it off mid-crawl and the UI would read it as "broken".
// Same reason as app/portal/packages/new/page.tsx. Mirrored in vercel.json.
export const maxDuration = 300;

// Admin-only screen (lib/nav.ts roles: ADMIN_ROLES) - refused here too, server-side,
// so an editor typing /price-light directly (not just missing the hidden nav item) never
// gets the screen. requireAdmin() throws for anyone else, which Next renders as the
// route's error boundary instead of the page.
export default async function PriceLightPage() {
  await requireAdmin();
  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title="רמזור מחירים"
        description="מה המתחרים מבקשים על אותו אירוע, ומה עושים עם אדום."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PriceLightClient />
      </Suspense>
    </div>
  );
}
