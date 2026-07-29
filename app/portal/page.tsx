import { getSession } from "@/lib/auth/guards";
import { getPortalDashboard } from "@/lib/actions/portal-dashboard-actions";
import { getMyCredit } from "@/lib/actions/partner-credit-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList,
  CheckCircle2,
  DollarSign,
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

export default async function PortalDashboardPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (they throw for non-agent/affiliate roles).
  if (!isPartner) return null;

  const [dashboard, credit] = await Promise.all([getPortalDashboard(), getMyCredit()]);

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

  const activity = [
    { label: "הזמנות ששולמו", value: dashboard.paidReservations, icon: CheckCircle2 },
    { label: "סה\"כ הזמנות", value: dashboard.totalReservations, icon: ClipboardList },
    { label: "כרטיסים ששולמו", value: dashboard.paidTickets, icon: Ticket },
    { label: "סה\"כ מכירות", value: usd.format(dashboard.totalSalesUsd), icon: DollarSign },
  ];

  const topStage = Math.max(...dashboard.traffic.byStage.map((s) => s.visitors), 1);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {money.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
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
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
                עדיין לא נרשמו כניסות. הנתונים מתחילים להיאסף ברגע שמישהו נכנס דרך לינק
                שמכיל את הקוד שלכם.
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
                          className="h-full rounded-full bg-primary"
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
            <CardTitle>מה הקהל שלכם מחפש</CardTitle>
            <CardDescription>
              האירועים שהכי נלחצו דרך הלינקים שלכם. מה שמסומן &quot;טרם הוזמן&quot; זה
              קהל שגילה עניין ולא סגר.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.clickedEvents.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                עדיין אין מספיק נתונים. הרשימה תתמלא ככל שיותר אנשים יקליקו על אירועים
                דרך הלינקים שלכם.
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

      <Card>
        <CardHeader>
          <CardTitle>קופונים</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-8 text-sm">
          <div>
            <p className="text-muted-foreground">קופונים פעילים</p>
            <p className="text-2xl font-bold">{dashboard.activeCoupons}</p>
          </div>
          <div>
            <p className="text-muted-foreground">שימושים</p>
            <p className="text-2xl font-bold">{dashboard.couponUses}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
