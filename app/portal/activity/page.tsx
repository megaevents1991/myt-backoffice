import Link from "next/link";
import { getSession } from "@/lib/auth/guards";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import {
  getPortalActivityFeed,
  getPortalUserActivity,
} from "@/lib/actions/portal-activity-actions";
import type { PortalActivityType } from "@/lib/actions/portal-activity-actions";
import { getPortalDashboard } from "@/lib/actions/portal-dashboard-actions";
import {
  getMyCredit,
  getMyVoucherSettlement,
  type PartnerCredit,
  type VoucherSettlement,
} from "@/lib/actions/partner-credit-actions";
import { PARTNER_ROLES, SELLER_ROLES } from "@/types/auth.types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BadgePercent,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileText,
  Link2,
  TicketPercent,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { InfoTabs, type InfoTabKey } from "../info-tabs";
import { UserActivityLog } from "../user-activity";
import { PendingCommissionList } from "../pending-commission-list";
import { PortalEntryFunnels } from "../entry-funnels";

export const dynamic = "force-dynamic";

/**
 * V2 "מידע ועדכונים" (2026-08-27 spec) - the old עדכונים page, renamed and
 * expanded to a tabbed hub: עדכונים (the feed) | לוג משתמשים | התחשבנות |
 * ביקושים | הצבירה שלי | הקופונים שלי. The last two live on their own routes
 * (their pages carry the same tab bar). Each tab fetches only its own data.
 */

const TYPE_META: Record<
  PortalActivityType,
  { icon: LucideIcon; badgeClass: string }
> = {
  quote_created: { icon: FileText, badgeClass: "bg-secondary/25 text-primary" },
  package_created: { icon: Link2, badgeClass: "bg-secondary/25 text-primary" },
  order_created: { icon: ClipboardList, badgeClass: "bg-muted text-muted-foreground" },
  order_paid: { icon: CheckCircle2, badgeClass: "bg-brand-mint/30 text-primary" },
  coupon_created: { icon: TicketPercent, badgeClass: "bg-secondary/25 text-primary" },
  coupon_redeemed: { icon: BadgePercent, badgeClass: "bg-brand-mint/30 text-primary" },
};

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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

async function UpdatesTab() {
  const feed = await getPortalActivityFeed();
  return (
    <Card>
      <CardHeader>
        <CardTitle>עדכונים ופעילות</CardTitle>
        <CardDescription>
          מה קרה סביב החשבון שלכם: הצעות מחיר, לינקים לחבילות, הזמנות שנכנסו
          והזמנות ששולמו.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {feed.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            אין עדיין פעילות להצגה.
          </p>
        ) : (
          <ul className="space-y-1">
            {feed.map((item, index) => {
              const meta = TYPE_META[item.type];
              const Icon = meta.icon;
              return (
                <li
                  key={`${item.type}-${item.at}-${index}`}
                  className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                >
                  <span className={`rounded-lg p-1.5 ${meta.badgeClass}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    {item.subtitle && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                  <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(item.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function UsersTab() {
  const userActivity = await getPortalUserActivity("all");
  return <UserActivityLog activity={userActivity} />;
}

async function SettlementTab({
  isAgent,
  isManager,
  creditAllowed,
}: {
  isAgent: boolean;
  isManager: boolean;
  creditAllowed: boolean;
}) {
  const [dashboard, credit, settlement] = await Promise.all([
    getPortalDashboard("all", "office"),
    creditAllowed ? getMyCredit() : Promise.resolve<PartnerCredit | null>(null),
    isAgent && creditAllowed
      ? getMyVoucherSettlement()
      : Promise.resolve<VoucherSettlement | null>(null),
  ]);

  const money = [
    {
      label: "עמלה לתשלום",
      value: usdExact.format(dashboard.commission.pendingUsd),
      hint: "ייכלל בדוח החודשי הקרוב",
      icon: CalendarClock,
    },
    {
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
            icon: TicketPercent,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
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

      {isAgent && settlement && (
        <Card>
          <CardHeader>
            <CardTitle>התחשבנות שוברים</CardTitle>
            <CardDescription>
              שוברים לגבייה - אותם נתונים כמו בעמוד הצבירה.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">לגבייה הקרובה</p>
                <p className="font-display text-2xl font-bold tabular-nums">
                  {settlement.dueSoonCount}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {usd.format(settlement.dueSoonUsd)}
                </p>
              </div>
              <div className="rounded-lg border border-destructive/40 p-3">
                <p className="text-xs text-destructive">עבר מועד גבייה</p>
                <p className="font-display text-2xl font-bold tabular-nums text-destructive">
                  {settlement.overdueCount}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {usd.format(settlement.overdueUsd)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">נפרעו</p>
                <p className="font-display text-2xl font-bold tabular-nums">
                  {settlement.settledCount}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {usd.format(settlement.settledUsd)}
                </p>
              </div>
            </div>
            <Link
              href="/portal/credit"
              className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              לפירוט המלא בעמוד הצבירה
            </Link>
          </CardContent>
        </Card>
      )}

      {isManager &&
        dashboard.agentBreakdown &&
        dashboard.agentBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>מכירות לפי סוכן</CardTitle>
              <CardDescription>לפי כל ההיסטוריה.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם</TableHead>
                      <TableHead className="text-center">הזמנות</TableHead>
                      <TableHead className="text-center">שולמו</TableHead>
                      <TableHead className="text-left">מכירות ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.agentBreakdown.map((row) => (
                      <TableRow key={row.sub || row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.totalReservations}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.paidReservations}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {usd.format(row.totalSalesUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}

async function DemandTab() {
  const dashboard = await getPortalDashboard("all", "office");
  const topStage = Math.max(...dashboard.traffic.byStage.map((s) => s.visitors), 1);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>מהלינקים שלכם לאתר</CardTitle>
            <CardDescription>
              כל המבקרים שהגיעו דרך הלינקים שלכם, לפי שלב.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!dashboard.traffic.hasData ? (
              <p className="py-6 text-sm text-muted-foreground">
                עדיין לא נרשמו כניסות. הנתונים מתחילים להיאסף ברגע שמישהו נכנס
                דרך לינק שמכיל את הקוד שלכם.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between rounded-lg border bg-muted/30 px-3 py-2">
                  <span className="text-sm font-medium">סה&quot;כ מבקרים</span>
                  <span className="font-display text-2xl font-bold tabular-nums">
                    {dashboard.traffic.totalVisitors}
                  </span>
                </div>
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
              האירועים שהכי נלחצו דרך הלינקים שלכם. מה שמסומן &quot;טרם
              הוזמן&quot; זה קהל שגילה עניין ולא סגר.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.clickedEvents.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                עדיין אין מספיק נתונים. הרשימה תתמלא ככל שיותר אנשים יקליקו על
                אירועים דרך הלינקים שלכם.
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
                        {[event.location, event.date].filter(Boolean).join(" · ") || "-"}
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

      {(dashboard.topPicks.flights.length > 0 ||
        dashboard.topPicks.hotels.length > 0 ||
        dashboard.topPicks.tickets.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>הנבחרים ביותר · מה הלקוחות שלכם באמת קונים</CardTitle>
            <CardDescription>
              הטיסות, המלונות והכרטיסים שנבחרו הכי הרבה בהזמנות ששולמו דרככם.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["כרטיסים", dashboard.topPicks.tickets],
                  ["טיסות", dashboard.topPicks.flights],
                  ["מלונות", dashboard.topPicks.hotels],
                ] as const
              ).map(([title, picks]) => (
                <div key={title}>
                  <p className="mb-2 text-sm font-semibold">{title}</p>
                  {picks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">אין עדיין נתונים</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {picks.map((pick) => (
                        <li
                          key={pick.label}
                          className="flex items-baseline justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate" dir="auto">
                            {pick.label}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            ×{pick.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {dashboard.entryFunnels && (
        <PortalEntryFunnels entryFunnels={dashboard.entryFunnels} />
      )}
    </div>
  );
}

export default async function PortalActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Staff visiting /portal see the layout's notice only.
  if (!isPartner) return null;

  const { tab: rawTab } = await searchParams;
  const tab: InfoTabKey =
    rawTab === "users" || rawTab === "settlement" || rawTab === "demand"
      ? rawTab
      : "updates";

  const profile = await getPortalProfile().catch(() => null);
  const creditAllowed = (profile?.credit_per_ticket ?? 0) > 0;
  const isAgent = SELLER_ROLES.includes(session.role);
  const isManager = session.role === "office_manager";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold">מידע ועדכונים</h1>
        <p className="text-sm text-muted-foreground">
          כל הנתונים סביב הפעילות שלכם - עדכונים, לוג משתמשים, התחשבנות
          וביקושים - במקום אחד.
        </p>
      </div>

      <InfoTabs active={tab} showCredit={creditAllowed} />

      {tab === "updates" && <UpdatesTab />}
      {tab === "users" && <UsersTab />}
      {tab === "settlement" && (
        <SettlementTab
          isAgent={isAgent}
          isManager={isManager}
          creditAllowed={creditAllowed}
        />
      )}
      {tab === "demand" && <DemandTab />}
    </div>
  );
}
