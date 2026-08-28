import { getSession } from "@/lib/auth/guards";
import { getPortalReservations } from "@/lib/actions/portal-actions";
import { getPackageBuilderEvents } from "@/lib/actions/portal-package-actions";
import { getAgentSlugForUser, agentUtmContent } from "@/lib/portal-attribution";
import { PARTNER_ROLES } from "@/types/auth.types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardSearch } from "./dashboard-search";
import { MyUpcomingReservations } from "./my-upcoming-reservations";

export const dynamic = "force-dynamic";

/**
 * V2 dashboard (2026-08-27 spec): a package search engine on top (default 8 =
 * the homepage-prioritized events, with a "כרטיסים בלבד" pricing toggle) and
 * "ההזמנות שלי" below it - future events, paid only, nearest event first.
 * Everything else the old dashboard carried (money tiles, funnels, demand,
 * user log, coupons) moved into עמוד "מידע ועדכונים" (/portal/activity).
 */
export default async function PortalDashboardPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only - never call partner
  // actions for them (they throw for non-partner roles).
  if (!isPartner || !session.partner_code) return null;

  const [events, reservationsPage, agentSlug] = await Promise.all([
    getPackageBuilderEvents().catch((error: unknown) => {
      console.error("PortalDashboardPage events:", error);
      return [];
    }),
    getPortalReservations().catch((error: unknown) => {
      console.error("PortalDashboardPage reservations:", error);
      return { rows: [], truncated: false, officeAgents: [] };
    }),
    getAgentSlugForUser(session.sub).catch(() => null),
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

      <MyUpcomingReservations rows={upcomingPaid} />
    </div>
  );
}
