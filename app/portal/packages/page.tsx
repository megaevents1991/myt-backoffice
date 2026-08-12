import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth/guards";
import {
  getMyPreparedPackages,
  getPackageBuilderEvents,
} from "@/lib/actions/portal-package-actions";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LinkBuilder } from "../links/link-builder";
import { LogoSettings } from "../links/logo-settings";
import { EventLinks } from "./event-links";
import { PackagesList } from "./packages-list";

export const dynamic = "force-dynamic";

export default async function PortalPackagesPage() {
  const session = await getSession();
  if (!session?.partner_code) return null;

  const [packages, events, profile] = await Promise.all([
    getMyPreparedPackages(),
    getPackageBuilderEvents().catch((error: unknown) => {
      // The packages list still stands on its own if the event search fails.
      console.error("PortalPackagesPage events:", error);
      return [];
    }),
    getPortalProfile().catch((error: unknown) => {
      console.error("PortalPackagesPage profile:", error);
      return null;
    }),
  ]);

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">החבילות והלינקים שלי</h1>
          <p className="text-sm text-muted-foreground">
            כל כלי ההפצה במקום אחד - קישור מהיר לכל אירוע, או חבילה מוכנה
            שמנחיתה את הלקוח ישר על הרכב שבחרתם.
          </p>
        </div>
        <Button
          asChild
          className="rounded-full bg-brand-mint px-5 font-semibold text-brand-forest transition-all duration-200 hover:bg-brand-mint/90 hover:shadow-mint-glow active:scale-[0.98]"
        >
          <Link href="/portal/packages/new">
            <Plus className="h-4 w-4" />
            בניית חבילה חדשה
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>קישור או חבילה לכל אירוע</CardTitle>
          <CardDescription>
            אירועים שאזלו, שעברו או שהוסרו לא מופיעים כאן.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventLinks trackingCode={session.partner_code} events={events} />
        </CardContent>
      </Card>

      <PackagesList packages={packages} isAgent={session.role === "agent"} />

      <Card>
        <CardHeader>
          <CardTitle>הלינקים שלי</CardTitle>
          <CardDescription>
            כל מי שנכנס דרך הלינקים האלה משויך אליכם - גם אם יזמין מאוחר יותר,
            וגם אם יעבור בינתיים בין עמודים באתר.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkBuilder
            trackingCode={session.partner_code}
            events={events.map((e) => ({
              id: e.id,
              name: e.name,
              date: e.date,
              location: e.location_name || null,
              suggested_price: e.site_price,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>הלוגו שלכם</CardTitle>
          <CardDescription>
            מלווה אתכם בלינקים ובהצעות שאתם שולחים ללקוחות, ומופיע בראש הפורטל.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoSettings logoUrl={profile?.logo_url ?? null} />
        </CardContent>
      </Card>
    </main>
  );
}
