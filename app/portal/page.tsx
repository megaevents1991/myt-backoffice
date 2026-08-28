import Link from "next/link";
import { getSession } from "@/lib/auth/guards";
import { getPortalProfile, getPortalReservations } from "@/lib/actions/portal-actions";
import { getPortalDashboard } from "@/lib/actions/portal-dashboard-actions";
import {
  getMyCredit,
  type PartnerCredit,
} from "@/lib/actions/partner-credit-actions";
import { getPackageBuilderEvents } from "@/lib/actions/portal-package-actions";
import { getAgentSlugForUser, agentUtmContent } from "@/lib/portal-attribution";
import type { InsightsRange } from "@/lib/actions/partner-performance-actions";
import { PARTNER_ROLES, SELLER_ROLES } from "@/types/auth.types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DashboardSearch } from "./dashboard-search";
import { NewPackagesRail } from "./new-packages-rail";
import { PendingCommissionList } from "./pending-commission-list";
import { ReservationsTable } from "./reservations/reservations-table";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Percent,
  Ticket,
  Wallet,
} from "lucide-react";

export const dynamic = "force-dynamic";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** The activity filter - scopes the activity tiles; the commission money
 *  tiles stay whole-history, same fact the invoice bills on. Default is the
 *  current calendar month (דור, 28.08) - "הכל" is heavy and rarely needed. */
const RANGE_OPTIONS: { key: InsightsRange; label: string }[] = [
  { key: "today", label: "היום" },
  { key: "yesterday", label: "אתמול" },
  { key: "3d", label: "3 ימים" },
  { key: "7d", label: "7 ימים" },
  { key: "month", label: "החודש" },
  { key: "90d", label: "90 יום" },
  { key: "all", label: "הכל" },
];
const DEFAULT_RANGE: InsightsRange = "month";

/**
 * V2 dashboard, one page for every partner role (2026-08-28 doc pass):
 * 1. חיפוש חבילות - the package search engine (default 8 recommended).
 * 2. Period pills → money tiles → activity tiles (the doc's two stat rows).
 * 3. מה חדש? - the last-30-days packages rail.
 * 4. ההזמנות שלי - the FULL reservations table, future+paid only, nearest
 *    event first, 10 rows with הצג עוד.
 * Funnels, demand, top picks, coupons and the user log moved to
 * /portal/activity (מידע ועדכונים).
 */
export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only - never call partner
  // actions for them (they throw for non-partner roles).
  if (!isPartner || !session.partner_code) return null;

  const { range: rawRange } = await searchParams;
  const range: InsightsRange = RANGE_OPTIONS.some((o) => o.key === rawRange)
    ? (rawRange as InsightsRange)
    : DEFAULT_RANGE;

  const isManager = session.role === "office_manager";
  const isSeller = SELLER_ROLES.includes(session.role);

  // Credit tile shows only when the office has a credit agreement - same rule
  // the nav item and the credit page enforce.
  const profile = await getPortalProfile();
  const creditAllowed = (profile?.credit_per_ticket ?? 0) > 0;

  const [events, reservationsPage, agentSlug, dashboard, credit] =
    await Promise.all([
      getPackageBuilderEvents().catch((error: unknown) => {
        console.error("PortalDashboardPage events:", error);
        return [];
      }),
      getPortalReservations().catch((error: unknown) => {
        console.error("PortalDashboardPage reservations:", error);
        return {
          rows: [],
          truncated: false,
          officeAgents: [] as { sub: string; name: string }[],
        };
      }),
      getAgentSlugForUser(session.sub).catch(() => null),
      getPortalDashboard(range, "office"),
      creditAllowed
        ? getMyCredit().catch(() => null)
        : Promise.resolve<PartnerCredit | null>(null),
    ]);
  const agentUtm = agentUtmContent(agentSlug);

  const now = Date.now();
  const upcomingPaid = reservationsPage.rows
    .filter(
      (r) =>
        r.status === "Paid" &&
        r.event_date != null &&
        new Date(r.event_date).getTime() > now,
    )
    .sort(
      (a, b) =>
        new Date(a.event_date ?? 0).getTime() -
        new Date(b.event_date ?? 0).getTime(),
    );

  const money = [
    {
      label: "עמלה לתשלום",
      value: usdExact.format(dashboard.commission.pendingUsd),
      // Reads the same `billed_at` fact the monthly report bills on, so this
      // figure and the invoice cannot disagree.
      hint: "ייכלל בדוח החודשי הקרוב",
      icon: CalendarClock,
    },
    {
      // NOT "paid to you": billed_at means it went out in a report, and the
      // report itself asks the partner to invoice before payment.
      label: "נכלל בדוחות",
      value: usdExact.format(dashboard.commission.billedUsd),
      hint: "כבר דווח לתשלום",
      icon: Wallet,
    },
    {
      label: "עמלות מתחילת השנה",
      value: usdExact.format(dashboard.commission.yearToDateUsd),
      hint: dashboard.commission.label,
      icon: DollarSign,
    },
    ...(credit
      ? [
          {
            label: "צבירה לחופשה",
            value: usdExact.format(credit.balanceUsd),
            hint:
              credit.creditPerTicket > 0
                ? `${usdExact.format(credit.creditPerTicket)} על כל כרטיס`
                : "אין הסכם צבירה",
            icon: Ticket,
          },
        ]
      : []),
  ];

  // The activity row follows the range filter. An influencer sees their
  // follower discount instead of the revenue tile.
  const activity = [
    {
      label: "הזמנות ששולמו",
      value: String(dashboard.paidReservations),
      icon: CheckCircle2,
    },
    {
      label: "סה\"כ הזמנות",
      value: String(dashboard.totalReservations),
      icon: ClipboardList,
    },
    {
      label: "כרטיסים ששולמו",
      value: String(dashboard.paidTickets),
      icon: Ticket,
    },
    isSeller
      ? {
          label: "סה\"כ מכירות",
          value: usd.format(dashboard.totalSalesUsd),
          icon: DollarSign,
        }
      : {
          label: "הנחה לעוקבים",
          value: dashboard.userDiscountLabel,
          icon: Percent,
        },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>חיפוש חבילות</CardTitle>
          <CardDescription>
            כל האירועים הפתוחים למכירה - העתיקו קישור או בנו חבילה. &quot;כרטיסים
            בלבד&quot; מציג את מחיר הכרטיס הזול ביותר כפי שהלקוח משלם באתר.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DashboardSearch
            trackingCode={session.partner_code}
            events={events}
            agentUtm={agentUtm}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={
              option.key === DEFAULT_RANGE
                ? "/portal"
                : `/portal?range=${option.key}`
            }
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              option.key === range
                ? "border-transparent bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {option.label}
          </Link>
        ))}
        <span className="ms-2 text-xs text-muted-foreground">
          הסינון חל על הפעילות והאירועים - לא על חיוב העמלה.
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {money.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="shadow-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <span className="rounded-lg bg-secondary/25 p-1.5 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
              </CardHeader>
              <CardContent>
                <div className="font-display text-2xl font-bold tabular-nums">
                  {card.value}
                </div>
                <p className="text-xs text-muted-foreground">{card.hint}</p>
                {card.label === "עמלה לתשלום" && (
                  <PendingCommissionList rows={dashboard.commission.pendingRows} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activity.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="shadow-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="font-display text-2xl font-bold tabular-nums">
                  {card.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {dashboard.newGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>מה חדש?</CardTitle>
            <CardDescription>
              אמנים וחבילות שעלו לאתר לאחרונה - לחיצה על כרטיס פותחת את כל
              התאריכים שלו, וכל קישור כבר נושא את קוד המעקב שלכם.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewPackagesRail groups={dashboard.newGroups} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ההזמנות שלי</CardTitle>
          <CardDescription>
            רק אירועים עתידיים ורק הזמנות ששולמו - מהאירוע הקרוב לרחוק. הרשימה
            המלאה בעמוד ההזמנות שלי.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingPaid.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              אין עדיין הזמנות ששולמו לאירועים קרובים.
            </div>
          ) : (
            <ReservationsTable
              rows={upcomingPaid}
              showAgentColumn={isManager}
              officeAgents={reservationsPage.officeAgents}
              hideFilters
              compact
              initialLimit={10}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
