import { Suspense } from "react";
import Link from "next/link";

import { requireCompany, type Company } from "@/lib/company";
import type { SessionPayload } from "@/lib/auth/session";
import { TOURS_HOME, visibleGroups } from "@/lib/nav";
import { formatDateShort, todayIso } from "@/lib/tours/deadlines";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewContent } from "@/components/tours/overview/overview-content";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { OverviewSkeleton } from "@/components/tours/overview/overview-skeleton";

// Per request always: the guard reads cookies, and its refusal is caught below -
// a build-time prerender must never bake the "not a tours company" notice in.
export const dynamic = "force-dynamic";

/**
 * /tours - the landing page of a company that sells tours (Mega Family):
 * what is on sale, what leaves soon, where the flight blocks stand and what
 * needs handling today.
 */
export default async function ToursOverviewPage() {
  let session: SessionPayload;
  let company: Company;
  try {
    ({ session, company } = await requireCompany("tours"));
  } catch (e) {
    // The active company does not sell tours (Mega Events) - say so, do not crash.
    // Anything else (no staff session) goes to the dashboard error boundary like on every guarded page.
    if (e instanceof Error && e.message.includes("does not sell")) return <NotAToursCompany />;
    throw e;
  }

  // The shortcuts are the sidebar's own Tours items, minus this page.
  const links = visibleGroups(session.role, company.productTypes)
    .filter((group) => group.productType === "tours")
    .flatMap((group) => group.items)
    .filter((item) => item.href !== TOURS_HOME);

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow={company.name}
        title="סקירה"
        description={`היציאות, קבוצות הטיסה והלידים של ${company.name}, נכון ל-${formatDateShort(todayIso())}. כל מספר וכל שורה מובילים למסך שבו מטפלים בהם.`}
        actions={<PublishSiteButton />}
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent links={links} />
      </Suspense>
    </div>
  );
}

function NotAToursCompany() {
  return (
    <div dir="rtl" className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">המסך הזה שייך לחברת טיולים</CardTitle>
          <CardDescription>
            סקירת הטיולים זמינה רק כשהחברה הפעילה מוכרת טיולים. אם יש לך גישה לחברה כזו, אפשר לעבור אליה
            מבורר החברות בסרגל העליון.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">חזרה לדשבורד</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
