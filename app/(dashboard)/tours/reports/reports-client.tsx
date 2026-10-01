"use client";

/**
 * /tours/reports - the flight reports of a tours company (functional spec 5.8):
 * realisation by month and airline, the deadlines of the next 30 days, and the
 * pool of blocks that serve no departure yet.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getDeadlineTaskAssignees,
  getToursReports,
  syncDeadlineTasks,
  type DeadlineTaskAssignee,
  type RealizationRow,
  type ToursReportsData,
} from "@/lib/actions/tours-reports-actions";
import { formatDateShort } from "@/lib/tours/deadlines";
import {
  BlockStatusBadge,
  DaysLeft,
  Ltr,
  Notice,
  Section,
  formatNumber,
} from "@/components/tours/flights/block-ui";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

const LOAD_FAILED = "טעינת הדוחות נכשלה. המסך זמין כשהחברה הפעילה מוכרת טיולים.";

const blockHref = (id: number) => `/tours/flights/${id}`;

type RealizationTotals = Omit<RealizationRow, "month" | "airline_code">;

function totalsOf(rows: RealizationRow[]): RealizationTotals {
  const totals: RealizationTotals = {
    groups_ordered: 0,
    pax_ordered: 0,
    groups_realized: 0,
    seats_realized: 0,
    groups_cancelled: 0,
    fees_paid: 0,
    potential_cost: 0,
    actual_cost: 0,
  };
  for (const row of rows) {
    totals.groups_ordered += row.groups_ordered;
    totals.pax_ordered += row.pax_ordered;
    totals.groups_realized += row.groups_realized;
    totals.seats_realized += row.seats_realized;
    totals.groups_cancelled += row.groups_cancelled;
    totals.fees_paid += row.fees_paid;
    totals.potential_cost += row.potential_cost;
    totals.actual_cost += row.actual_cost;
  }
  return totals;
}

export function ReportsClient() {
  const [data, setData] = useState<ToursReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState<DeadlineTaskAssignee[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (year?: number) => {
    setLoading(true);
    try {
      const res = await getToursReports(year);
      if (res.success) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("reports: load failed", e);
      setError(LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    getDeadlineTaskAssignees()
      .then((res) => {
        if (!res.success) return;
        setAssignees(res.data);
        setAssigneeId((current) => current || res.data[0]?.id || "");
      })
      .catch((e) => console.error("reports: assignees load failed", e));
  }, [load]);

  const createTasks = async () => {
    setSyncing(true);
    try {
      const res = await syncDeadlineTasks({ assigneeId: assigneeId || null });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const { created, existing, skippedDone } = res.data;
      const parts = [
        created === 0 ? "לא נוצרו משימות חדשות" : created === 1 ? "נוצרה משימה אחת" : `נוצרו ${created} משימות`,
        existing > 0 ? `${existing} כבר קיימות` : null,
        skippedDone > 0 ? `${skippedDone} מועדים כבר בוצעו` : null,
      ].filter(Boolean);
      toast.success(parts.join(" · "), { duration: 6000 });
    } catch (e) {
      console.error("reports: task sync failed", e);
      toast.error("יצירת המשימות נכשלה. נסו שוב.");
    } finally {
      setSyncing(false);
    }
  };

  const totals = data ? totalsOf(data.realization) : null;
  const soon = data ? data.deadlines.filter((d) => d.days_left <= 7 && !d.done).length : 0;
  const poolBlocks = data ? data.pool.reduce((sum, g) => sum + g.blocks.length, 0) : 0;

  return (
    <div dir="rtl">
      <PageHeader
        title="דוחות טיסות"
        description="מימוש קבוצות הטיסה מול ההזמנה, המועדים של 30 הימים הקרובים, והבלוקים שעוד לא שויכו ליציאה. הכל מחושב מהנתונים בזמן הטעינה."
      />

      {error && (
        <div className="mb-4 space-y-2">
          <Notice tone="danger">{error}</Notice>
          <Button size="sm" variant="outline" onClick={() => void load(data?.year)}>
            ניסיון נוסף
          </Button>
        </div>
      )}

      {data === null && !error ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : data !== null ? (
        <div className="space-y-4">
          <Section
            title="מימוש לפי חודש וחברת תעופה"
            description="קבוצות ונוסעים שהוזמנו מול מה שמומש (אושר, הועבר לתפעול או כורטס), קבוצות שבוטלו ודמי הביטול ששולמו. הסכומים במטבע העלות של כל בלוק, בלי המרה."
            actions={
              <Select
                dir="rtl"
                value={String(data.year)}
                onValueChange={(v) => void load(Number(v))}
                disabled={loading}
              >
                <SelectTrigger className="w-28" aria-label="שנה">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            {data.realization.length === 0 ? (
              <Notice>אין קבוצות טיסה בשנת {data.year}.</Notice>
            ) : (
              <Table look="list" className={loading ? "opacity-60" : undefined}>
                <TableHeader>
                  <TableRow>
                    <TableHead>חודש</TableHead>
                    <TableHead>חברה</TableHead>
                    <TableHead>קבוצות שהוזמנו</TableHead>
                    <TableHead>נוסעים שהוזמנו</TableHead>
                    <TableHead>קבוצות שמומשו</TableHead>
                    <TableHead>מושבים שמומשו</TableHead>
                    <TableHead>קבוצות שבוטלו</TableHead>
                    <TableHead>דמי ביטול</TableHead>
                    <TableHead>פוטנציאל</TableHead>
                    <TableHead>בפועל</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.realization.map((r, i) => {
                    const firstOfMonth = i === 0 || data.realization[i - 1].month !== r.month;
                    return (
                      <TableRow key={`${r.month}:${r.airline_code}`} className={firstOfMonth && i > 0 ? "border-t-2" : undefined}>
                        <TableCell className="font-medium">{firstOfMonth ? monthName(r.month) : ""}</TableCell>
                        <TableCell>
                          <Ltr>{r.airline_code}</Ltr>
                        </TableCell>
                        <TableCell className="tabular-nums">{r.groups_ordered}</TableCell>
                        <TableCell className="tabular-nums">{formatNumber(r.pax_ordered)}</TableCell>
                        <TableCell className="tabular-nums">{r.groups_realized}</TableCell>
                        <TableCell className="tabular-nums">{formatNumber(r.seats_realized)}</TableCell>
                        <TableCell className="tabular-nums">{r.groups_cancelled}</TableCell>
                        <TableCell>
                          <Ltr>{formatNumber(r.fees_paid)}</Ltr>
                        </TableCell>
                        <TableCell>
                          <Ltr>{formatNumber(r.potential_cost)}</Ltr>
                        </TableCell>
                        <TableCell>
                          <Ltr>{formatNumber(r.actual_cost)}</Ltr>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {totals && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">סך הכל {data.year}</TableCell>
                      <TableCell />
                      <TableCell className="font-semibold tabular-nums">{totals.groups_ordered}</TableCell>
                      <TableCell className="font-semibold tabular-nums">{formatNumber(totals.pax_ordered)}</TableCell>
                      <TableCell className="font-semibold tabular-nums">{totals.groups_realized}</TableCell>
                      <TableCell className="font-semibold tabular-nums">{formatNumber(totals.seats_realized)}</TableCell>
                      <TableCell className="font-semibold tabular-nums">{totals.groups_cancelled}</TableCell>
                      <TableCell className="font-semibold">
                        <Ltr>{formatNumber(totals.fees_paid)}</Ltr>
                      </TableCell>
                      <TableCell className="font-semibold">
                        <Ltr>{formatNumber(totals.potential_cost)}</Ltr>
                      </TableCell>
                      <TableCell className="font-semibold">
                        <Ltr>{formatNumber(totals.actual_cost)}</Ltr>
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </Section>

          <Section
            title={`מועדים קרובים (${data.deadlines.length})`}
            description="מועדים של בלוקים חיים ב-30 הימים הקרובים. הכפתור פותח משימה בלוח התפעול לכל מועד שחל בשבעת הימים הקרובים ועוד אין לו משימה."
            actions={
              <>
                {assignees.length > 1 && (
                  <Select dir="rtl" value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger className="w-48" aria-label="למי לשייך את המשימות">
                      <SelectValue placeholder="למי לשייך" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignees.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button size="sm" onClick={createTasks} disabled={syncing}>
                  {syncing ? "יוצר משימות..." : "צור משימות למועדים קרובים"}
                </Button>
              </>
            }
          >
            {data.deadlines.length === 0 ? (
              <Notice>אין מועד של בלוק חי ב-30 הימים הקרובים.</Notice>
            ) : (
              <>
                {soon > 0 && (
                  <p className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                    {soon === 1 ? "מועד אחד חל" : `${soon} מועדים חלים`} בשבעת הימים הקרובים.
                  </p>
                )}
                <Table look="list">
                  <TableHeader>
                    <TableRow>
                      <TableHead>מועד</TableHead>
                      <TableHead>תאריך</TableHead>
                      <TableHead>נשאר</TableHead>
                      <TableHead>בלוק</TableHead>
                      <TableHead>טיסה</TableHead>
                      <TableHead>PNR</TableHead>
                      <TableHead>מושבים</TableHead>
                      <TableHead>סטטוס</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.deadlines.map((d) => (
                      <TableRow key={`${d.flight_id}:${d.field}`}>
                        <TableCell className="font-medium">{d.label}</TableCell>
                        <TableCell>
                          <Ltr>{formatDateShort(d.date)}</Ltr>
                        </TableCell>
                        <TableCell>
                          <DaysLeft days={d.days_left} done={d.done} />
                        </TableCell>
                        <TableCell>
                          <Link href={blockHref(d.flight_id)} className="text-primary underline-offset-4 hover:underline">
                            <Ltr>
                              {d.airline_code} {d.route}
                            </Ltr>
                          </Link>
                          {d.season_label && <span className="ms-2 text-xs text-muted-foreground">{d.season_label}</span>}
                        </TableCell>
                        <TableCell>
                          <Ltr>{formatDateShort(d.outbound_date)}</Ltr>
                        </TableCell>
                        <TableCell>{d.pnr ? <Ltr>{d.pnr}</Ltr> : "-"}</TableCell>
                        <TableCell className="tabular-nums">{d.seats}</TableCell>
                        <TableCell>
                          <BlockStatusBadge status={d.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </Section>

          <Section
            title={`מאגר: בלוקים בלי שיוך (${poolBlocks})`}
            description="בלוקים עתידיים שלא בוטלו ולא נדחו ועוד לא משרתים אף יציאה, לפי תווית העונה."
          >
            {data.pool.length === 0 ? (
              <Notice>כל הבלוקים העתידיים משויכים ליציאה.</Notice>
            ) : (
              <div className="space-y-2">
                {data.pool.map((group) => (
                  <details key={group.label || "__none__"} className="rounded-md border">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-medium" dir="auto">
                        {group.label || "בלי תווית עונה"}
                      </span>
                      <span className="text-muted-foreground">
                        {group.blocks.length === 1 ? "בלוק אחד" : `${group.blocks.length} בלוקים`} · {group.seats} מושבים
                      </span>
                    </summary>
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>בלוק</TableHead>
                            <TableHead>הלוך</TableHead>
                            <TableHead>חזור</TableHead>
                            <TableHead>מושבים</TableHead>
                            <TableHead>PNR</TableHead>
                            <TableHead>סדרה</TableHead>
                            <TableHead>סטטוס</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.blocks.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell>
                                <Link href={blockHref(b.id)} className="text-primary underline-offset-4 hover:underline">
                                  <Ltr>
                                    {b.airline_code} {b.route}
                                  </Ltr>
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Ltr>{formatDateShort(b.outbound_date)}</Ltr>
                              </TableCell>
                              <TableCell>
                                <Ltr>{formatDateShort(b.inbound_date)}</Ltr>
                              </TableCell>
                              <TableCell className="tabular-nums">{b.seats}</TableCell>
                              <TableCell>{b.pnr ? <Ltr>{b.pnr}</Ltr> : "-"}</TableCell>
                              <TableCell dir="auto">{b.series_name ?? "-"}</TableCell>
                              <TableCell>
                                <BlockStatusBadge status={b.status} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}
