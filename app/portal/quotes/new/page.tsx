import Link from "next/link";
import { PackagePlus, FileText } from "lucide-react";
import { getSession } from "@/lib/auth/guards";
import {
  getQuoteEvents,
  getMyAgentTerms,
  getQuotePackageUnitPrice,
} from "@/lib/actions/quote-actions";
import { getMyPreparedPackages } from "@/lib/actions/portal-package-actions";
import { PARTNER_ROLES, SELLER_ROLES } from "@/types/auth.types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QuoteForm, type QuotePrefill } from "./quote-form";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function NewPortalQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ package?: string }>;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Quotes are a seller tool (agent/office_manager); an influencer only promotes a link.
  if (!isPartner || !SELLER_ROLES.includes(session.role)) return null;

  const { package: packageParam } = await searchParams;

  // הצעה מתחילה מחבילה (אלון ודור, 2026-08-06): without a chosen package the
  // page is a picker, not a bare PDF form. "free" is the explicit opt-out.
  const packageId = Number(packageParam);
  const freeForm = packageParam === "free";

  if (!freeForm && !Number.isFinite(packageId)) {
    const packages = await getMyPreparedPackages();
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">הצעת מחיר חדשה</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            הצעה נבנית מתוך חבילה - כך המחיר, הלינק לתשלום והמעקב מגיעים מוכנים.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackagePlus className="h-4 w-4 text-muted-foreground" />
              בחרו חבילה קיימת
            </CardTitle>
            <CardDescription>
              החבילות שבניתם - ההצעה תישא את ההרכבה והמחיר שלהן.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {packages.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                עדיין אין לכם חבילות מוכנות.
              </p>
            ) : (
              packages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{pkg.event_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        pkg.location_name,
                        pkg.event_date
                          ? new Date(pkg.event_date).toLocaleDateString("he-IL")
                          : null,
                        `${pkg.qty} × ${pkg.category}`,
                        pkg.flight === "none" ? "ללא טיסה" : null,
                        pkg.hotel === "none" ? "ללא מלון" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {pkg.price_per_person != null && (
                      <span className="text-sm font-medium tabular-nums">
                        {usd.format(pkg.price_per_person)} לנוסע
                      </span>
                    )}
                    <Button asChild size="sm">
                      <Link href={`/portal/quotes/new?package=${pkg.id}`}>
                        בנו הצעה
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
            <Button asChild variant="outline" className="mt-2">
              <Link href="/portal/packages/new">
                <PackagePlus className="ml-2 h-4 w-4" />
                בנו חבילה חדשה
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div className="text-sm text-muted-foreground">
          <Link
            href="/portal/quotes/new?package=free"
            className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            הצעה חופשית בלי חבילה (למקרים חריגים)
          </Link>
        </div>
      </div>
    );
  }

  const [events, terms] = await Promise.all([
    getQuoteEvents(),
    getMyAgentTerms(),
  ]);

  // "שלח הצעה ללקוח" on a prepared package lands here with ?package= - seed
  // the quote from that package: its composition PRICE (not the generic event
  // price), its coded order link for the PDF, and its story in the notes.
  let prefill: QuotePrefill | null = null;
  if (Number.isFinite(packageId)) {
    const [mine, unitPrice] = await Promise.all([
      getMyPreparedPackages(),
      getQuotePackageUnitPrice(packageId),
    ]);
    const pkg = mine.find((p) => p.id === packageId);
    if (pkg) {
      const parts = [
        `ההצעה מבוססת על חבילה מוכנה: ${pkg.qty} × ${pkg.category}`.trim(),
        pkg.flight === "offline" && pkg.flight_summary
          ? `טיסה: ${pkg.flight_summary}`
          : pkg.flight === "none"
            ? "ללא טיסה"
            : "טיסה לבחירת הלקוח באתר",
        pkg.hotel === "offline" && pkg.hotel_summary
          ? `מלון: ${pkg.hotel_summary}`
          : pkg.hotel === "none"
            ? "ללא מלון"
            : "מלון לבחירת הלקוח באתר",
      ].filter(Boolean);
      prefill = {
        packageId: pkg.id,
        eventId: pkg.event_id,
        qty: pkg.qty,
        note: parts.join("\n"),
        paymentLink: pkg.link,
        unitPrice: unitPrice ?? pkg.price_per_person ?? null,
      };
    }
  }

  return <QuoteForm events={events} terms={terms} prefill={prefill} />;
}
