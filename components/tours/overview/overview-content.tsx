import Link from "next/link";
import { CalendarCheck, CalendarClock, Inbox, Plane } from "lucide-react";

import type { NavItem } from "@/lib/nav";
import { getToursOverview, type OverviewDeadline } from "@/lib/actions/tours-overview-actions";
import { daysLeft, formatDateShort } from "@/lib/tours/deadlines";
import { BLOCK_STATUS_LABELS } from "@/types/tours.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttentionList, type AttentionRow } from "./attention-list";
import { QuickLinks } from "./quick-links";
import { StatCard } from "./stat-card";

const DEADLINE_KIND_LABELS: Record<OverviewDeadline["deadlineKind"], string> = {
  first: "ביטול ראשון",
  last: "ביטול אחרון",
};

/** "היום" / "מחר" / "בעוד 5 ימים" for a date that is today or later. */
function inDays(date: string, today: string): string {
  const days = daysLeft(date, today);
  if (days === null) return "";
  if (days <= 0) return "היום";
  if (days === 1) return "מחר";
  return `בעוד ${days} ימים`;
}

/** Codes, airports and flight numbers stay left-to-right inside the Hebrew line. */
const Ltr = ({ children }: { children: React.ReactNode }) => (
  <span dir="ltr" className="font-mono text-[0.95em]">
    {children}
  </span>
);

/**
 * The loaded Tours overview: count cards, the two "needs attention" lists, the
 * flight blocks by status and the shortcuts. Rendered inside a Suspense on /tours.
 */
export async function OverviewContent({ links }: { links: NavItem[] }) {
  const result = await getToursOverview();

  if (!result.success) {
    return (
      <div className="space-y-6">
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-medium">טעינת הנתונים נכשלה</p>
          <p className="mt-1 text-xs" dir="auto">
            {result.error}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">רענון הדף מנסה שוב. המסכים עצמם זמינים בקישורים למטה.</p>
        </div>
        <QuickLinks items={links} />
      </div>
    );
  }

  const o = result.data;
  const upcomingBlocks = o.blocksByStatus.reduce((sum, s) => sum + s.upcoming, 0);
  // `links` is the sidebar's own list, already cut by the viewer's role: the
  // approvals screen is in it only for the company manager and for superadmin.
  const approvals = links.find((item) => item.href === "/tours/approvals");

  const departureRows: AttentionRow[] = o.departuresWithoutBlock.map((d) => ({
    key: d.id,
    href: `/tours/departures?code=${encodeURIComponent(d.code)}`,
    title: (
      <>
        <Ltr>{d.code}</Ltr>
        {d.packageName && <span className="mr-2 font-normal text-muted-foreground">{d.packageName}</span>}
      </>
    ),
    detail: `יציאה ב-${formatDateShort(d.startDate)}`,
    aside: inDays(d.startDate, o.today),
  }));

  const deadlineRows: AttentionRow[] = o.deadlines.map((f) => ({
    key: String(f.flightId),
    href: `/offline-flights/${f.flightId}`,
    title: (
      <>
        {DEADLINE_KIND_LABELS[f.deadlineKind]} · {formatDateShort(f.deadline)}
        <span className="mr-2 font-normal text-muted-foreground">
          <Ltr>
            {[f.flightNumber ?? f.airlineCode, f.from && f.to ? `${f.from}→${f.to}` : null]
              .filter(Boolean)
              .join(" ")}
          </Ltr>
        </span>
      </>
    ),
    detail: [
      f.departureDate ? `טיסה ב-${formatDateShort(f.departureDate)}` : null,
      BLOCK_STATUS_LABELS[f.status],
      f.seriesName,
    ]
      .filter(Boolean)
      .join(" · "),
    aside: inDays(f.deadline, o.today),
  }));

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="יציאות מפורסמות"
          value={o.publishedFutureDepartures}
          hint="מפורסמות באתר, מהיום והלאה"
          href="/tours/departures"
          icon={CalendarCheck}
        />
        <StatCard
          label={`יציאות ב-${o.departuresWindowDays} הימים הקרובים`}
          value={o.departuresInWindow}
          hint={`מתוכן ${o.publishedDeparturesInWindow.toLocaleString("he-IL")} מפורסמות`}
          href="/tours/departures"
          icon={CalendarClock}
        />
        <StatCard
          label="קבוצות טיסה"
          value={o.blocksTotal}
          hint={`מתוכן ${upcomingBlocks.toLocaleString("he-IL")} שעוד לא טסו`}
          href="/offline-flights"
          icon={Plane}
        />
        <StatCard
          label="לידים חדשים"
          value={o.newLeads}
          hint="פניות מהאתר שעוד לא טופלו"
          href="/tours/leads"
          icon={Inbox}
        />
      </div>

      <section aria-labelledby="tours-attention" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="tours-attention" className="font-display text-lg font-semibold">
            דורש טיפול
          </h2>
          {approvals && (
            <Link
              href={approvals.href}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              לכל מה שמחכה לאישור ולטיפול של מנהל
            </Link>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <AttentionList
            title="יציאות מפורסמות בלי קבוצת טיסה פעילה"
            description="יציאות עתידיות שמוצגות באתר ואין להן אף קבוצת טיסה מאושרת, בתפעול או מכורטסת."
            rows={departureRows}
            total={departureRows.length}
            emptyText="לכל היציאות המפורסמות יש קבוצת טיסה פעילה."
            moreHref="/tours/departures"
          />
          <AttentionList
            title={`מועדי ביטול ב-${o.deadlineWindowDays} הימים הקרובים`}
            description="קבוצות טיסה מאושרות או בתפעול שמועד הביטול הראשון או האחרון שלהן מתקרב."
            rows={deadlineRows}
            total={o.deadlinesTotal}
            emptyText="אין מועדי ביטול בשבועיים הקרובים."
            moreHref="/offline-flights"
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">קבוצות טיסה לפי סטטוס</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {o.blocksByStatus.length === 0 ? (
              <p className="rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
                עדיין אין קבוצות טיסה.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {o.blocksByStatus.map((s) => (
                  <li key={s.status ?? "none"} className="flex items-baseline justify-between gap-3 py-2">
                    <span>{s.status ? BLOCK_STATUS_LABELS[s.status] : "ללא סטטוס"}</span>
                    <span className="flex items-baseline gap-2">
                      {s.upcoming > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {s.upcoming.toLocaleString("he-IL")} שעוד לא טסו
                        </span>
                      )}
                      <span className="min-w-8 text-left font-display font-semibold tabular-nums">
                        {s.total.toLocaleString("he-IL")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/offline-flights"
              className="mt-3 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              לכל קבוצות הטיסה
            </Link>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <QuickLinks items={links} />
        </div>
      </div>
    </div>
  );
}
