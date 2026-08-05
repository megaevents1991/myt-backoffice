import Link from "next/link";
import { getSession } from "@/lib/auth/guards";
import { getPortalDashboard } from "@/lib/actions/portal-dashboard-actions";
import { getMyCredit } from "@/lib/actions/partner-credit-actions";
import type { InsightsRange } from "@/lib/actions/partner-performance-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PortalEntryFunnels } from "./entry-funnels";
import {
  ClipboardList,
  CheckCircle2,
  DollarSign,
  Percent,
  Wallet,
  Ticket,
  CalendarClock,
} from "lucide-react";

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

/** The top filter — scopes every activity figure below it (the commission
 *  money tiles stay whole-history, same fact the invoice bills on). */
const RANGE_OPTIONS: { key: InsightsRange; label: string }[] = [
  { key: "today", label: "היום" },
  { key: "yesterday", label: "אתמול" },
  { key: "3d", label: "3 ימים" },
  { key: "7d", label: "7 ימים" },
  { key: "30d", label: "30 יום" },
  { key: "90d", label: "90 יום" },
  { key: "all", label: "הכול" },
];

export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (they throw for non-agent/affiliate roles).
  if (!isPartner) return null;

  const { range: rawRange } = await searchParams;
  const range: InsightsRange = RANGE_OPTIONS.some((o) => o.key === rawRange)
    ? (rawRange as InsightsRange)
    : "all";

  const isAgent = session.role === "agent";
  const [dashboard, credit] = await Promise.all([
    getPortalDashboard(range),
    getMyCredit(),
  ]);

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
    {
      label: "צבירה לחופשה",
      value: usdExact.format(credit.balanceUsd),
      hint:
        credit.creditPerTicket > 0
          ? `${usdExact.format(credit.creditPerTicket)} על כל כרטיס`
          : "אין הסכם צבירה",
      icon: Ticket,
    },
  ];

  // The activity row follows the range filter. An influencer sees their
  // follower discount instead of the revenue tile (הורד לבקשת אלון ודור).
  const activity = [
    { label: "הזמנות ששולמו", value: String(dashboard.paidReservations), icon: CheckCircle2 },
    { label: "סה\"כ הזמנות", value: String(dashboard.totalReservations), icon: ClipboardList },
    { label: "כרטיסים ששולמו", value: String(dashboard.paidTickets), icon: Ticket },
    isAgent
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

  const topStage = Math.max(...dashboard.traffic.byStage.map((s) => s.visitors), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={option.key === "all" ? "/portal" : `/portal?range=${option.key}`}
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
          הסינון חל על הפעילות, המשפכים והאירועים — לא על תיקי העמלה.
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
                <div className="font-display text-2xl font-bold tabular-nums">{card.value}</div>
                <p className="text-xs text-muted-foreground">{card.hint}</p>
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
                <div className="font-display text-2xl font-bold tabular-nums">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {dashboard.newEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>מה חדש?</CardTitle>
            <CardDescription>
              חבילות שעלו לאתר ב-30 הימים האחרונים — כל קישור כבר נושא את קוד
              המעקב שלכם.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {dashboard.newEvents.map((event) => (
                <a
                  key={event.id}
                  href={event.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-44 shrink-0 overflow-hidden rounded-lg border transition-colors hover:border-primary"
                >
                  {event.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.image_url}
                      alt=""
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center bg-muted text-muted-foreground">
                      <Ticket className="h-6 w-6" />
                    </div>
                  )}
                  <div className="space-y-0.5 p-2">
                    <p className="truncate text-sm font-medium">{event.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        event.location,
                        event.date
                          ? new Date(event.date).toLocaleDateString("he-IL")
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>מהלינקים שלכם לאתר</CardTitle>
            <CardDescription>
              מבקרים שונים בכל שלב, מתוך מי שהגיע דרך הלינקים שלכם.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!dashboard.traffic.hasData ? (
              <p className="py-6 text-sm text-muted-foreground">
                עדיין לא נרשמו כניסות בתקופה הזו. הנתונים מתחילים להיאסף ברגע
                שמישהו נכנס דרך לינק שמכיל את הקוד שלכם.
              </p>
            ) : (
              <div className="space-y-3">
                {dashboard.traffic.byStage.map((stage) => {
                  const share = Math.round((stage.visitors / topStage) * 100);
                  return (
                    <div key={stage.stage} className="space-y-1">
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{stage.label}</span>
                        <span className="font-medium tabular-nums">{stage.visitors}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-brand-mint"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>WHAT&apos;S IN DEMAND · על מה הקהל שלכם מסתכל</CardTitle>
            <CardDescription>
              האירועים שהכי נלחצו דרך הלינקים שלכם בתקופה שנבחרה. מה שמסומן
              &quot;טרם הוזמן&quot; זה קהל שגילה עניין ולא סגר.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.clickedEvents.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                עדיין אין מספיק נתונים בתקופה הזו. הרשימה תתמלא ככל שיותר אנשים
                יקליקו על אירועים דרך הלינקים שלכם.
              </p>
            ) : (
              <ul className="space-y-3">
                {dashboard.clickedEvents.map((event) => (
                  <li
                    key={`${event.name}-${event.date ?? ""}-${event.location ?? ""}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{event.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[event.location, event.date].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {event.visitors}
                      </span>
                      {!event.booked && (
                        <Badge variant="secondary" className="whitespace-nowrap">
                          טרם הוזמן
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {dashboard.entryFunnels && (
        <PortalEntryFunnels entryFunnels={dashboard.entryFunnels} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>קופונים</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-8 text-sm">
          <div>
            <p className="text-muted-foreground">קופונים פעילים</p>
            <p className="font-display text-2xl font-bold tabular-nums">{dashboard.activeCoupons}</p>
          </div>
          <div>
            <p className="text-muted-foreground">שימושים</p>
            <p className="font-display text-2xl font-bold tabular-nums">{dashboard.couponUses}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
