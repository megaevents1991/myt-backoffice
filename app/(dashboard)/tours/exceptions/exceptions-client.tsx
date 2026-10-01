"use client";

/**
 * /tours/exceptions ("בעיות נתונים") - the gaps between departures, prices and
 * flight blocks (functional spec 5.9). Every list is computed from the database
 * on load, with a link to the screen where the row is fixed.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getDataProblems,
  type AllocationProblem,
  type BlockProblem,
  type DataProblems,
  type DepartureProblem,
} from "@/lib/actions/tours-reports-actions";
import { formatDateShort } from "@/lib/tours/deadlines";
import { Ltr, Notice } from "@/components/tours/ui";

const LOAD_FAILED = "טעינת הנתונים נכשלה. המסך זמין כשהחברה הפעילה מוכרת טיולים.";

const departureHref = (code: string) => `/tours/departures?code=${encodeURIComponent(code)}`;
const blockHref = (id: number) => `/offline-flights/${id}`;

const linkClass = "text-primary underline-offset-4 hover:underline";

export function ExceptionsClient() {
  const [data, setData] = useState<DataProblems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [includePast, setIncludePast] = useState(false);

  const load = useCallback(async (past: boolean) => {
    setLoading(true);
    try {
      const res = await getDataProblems(past);
      if (res.success) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("exceptions: load failed", e);
      setError(LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(includePast);
  }, [load, includePast]);

  const total = data
    ? data.noLiveBlock.length +
      data.allBlocksDead.length +
      data.dateMismatch.length +
      data.routeMismatch.length +
      data.noDoublePrice.length +
      data.negativeRemaining.length +
      data.blocksMissingData.length
    : 0;

  return (
    <div dir="rtl">
      <PageHeader
        title="בעיות נתונים"
        description="פערים בין היציאות, המחירים וקבוצות הטיסה. כל רשימה מחושבת מהנתונים בזמן הטעינה, וכל שורה מובילה למסך שבו מתקנים אותה."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={includePast} onCheckedChange={setIncludePast} disabled={loading} />
              כולל יציאות וטיסות שעברו
            </label>
            <Button size="sm" variant="outline" onClick={() => void load(includePast)} disabled={loading}>
              {loading ? "טוען..." : "רענון"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {data === null && !error ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : data !== null ? (
        <div className={loading ? "space-y-3 opacity-60" : "space-y-3"}>
          {total === 0 && <Notice tone="muted">לא נמצאו בעיות. הנתונים עקביים.</Notice>}

          <ProblemList
            title="יציאות מפורסמות בלי טיסה חיה"
            hint="היציאה מוצגת באתר, ואף בלוק שאושר בחברת התעופה לא משויך אליה. לתיקון: לשייך בלוק חי, או להסיר מפרסום."
            count={data.noLiveBlock.length}
          >
            <DepartureTable rows={data.noLiveBlock} />
          </ProblemList>

          <ProblemList
            title="יציאות שכל הבלוקים שלהן בוטלו או נדחו"
            hint="ליציאה שויכו בלוקים, אבל אף אחד מהם לא בתוקף. לתיקון: למצוא בלוק חלופי ולשייך."
            count={data.allBlocksDead.length}
          >
            <DepartureTable rows={data.allBlocksDead} />
          </ProblemList>

          <ProblemList
            title="שיוכים שתאריך הטיסה שלהם שונה מתאריך היציאה"
            hint="הפרש של יום יכול להיות תקין (טיסת לילה). לתיקון: לתקן את תאריך היציאה, או להחליף בלוק."
            count={data.dateMismatch.length}
          >
            <AllocationTable rows={data.dateMismatch} />
          </ProblemList>

          <ProblemList
            title="שיוכים שהמסלול שלהם לא תואם ליציאה"
            hint="עיר הנחיתה או עיר החזרה של הבלוק שונה מזו של היציאה. לתיקון: לתקן את מסלול היציאה, או להסיר את השיוך."
            count={data.routeMismatch.length}
          >
            <AllocationTable rows={data.routeMismatch} />
          </ProblemList>

          <ProblemList
            title="יציאות בלי מחיר לחדר זוגי"
            hint="בלי מחיר למבוגר בחדר זוגי אי אפשר לפרסם את היציאה. לתיקון: להזין מחירים בכרטיס היציאה."
            count={data.noDoublePrice.length}
          >
            <DepartureTable rows={data.noDoublePrice} />
          </ProblemList>

          <ProblemList
            title="יציאות עם יתרת מושבים שלילית"
            hint="נמכרו יותר מושבים ממה שהבלוקים החיים של היציאה מחזיקים. לתיקון: לשייך מושבים נוספים, או לתקן את רישומי המכירות."
            count={data.negativeRemaining.length}
          >
            <DepartureTable rows={data.negativeRemaining} />
          </ProblemList>

          <ProblemList
            title="בלוקים מאושרים בלי PNR או בלי חוזה"
            hint='בלוק בסטטוס "אושר בחברת התעופה" או "הועבר לתפעול" חייב PNR וחוזה. לתיקון: להשלים בכרטיס הבלוק.'
            count={data.blocksMissingData.length}
          >
            <BlockTable rows={data.blocksMissingData} />
          </ProblemList>
        </div>
      ) : null}
    </div>
  );
}

function ProblemList({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="rounded-lg border bg-card shadow-sm" open={count > 0 && count <= 15}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <Badge variant={count > 0 ? "destructive" : "secondary"} className="tabular-nums">
          {count}
        </Badge>
        <span className="font-display text-base font-semibold">{title}</span>
      </summary>
      <div className="border-t px-4 py-3">
        <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
        {count === 0 ? <span className="text-sm text-muted-foreground">אין שורות.</span> : children}
      </div>
    </details>
  );
}

function DepartureTable({ rows }: { rows: DepartureProblem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>יציאה</TableHead>
          <TableHead>תאריכים</TableHead>
          <TableHead>מסלול</TableHead>
          <TableHead>פרסום</TableHead>
          <TableHead>פירוט</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.departure_id}>
            <TableCell>
              <Link href={departureHref(r.code)} className={`font-medium ${linkClass}`}>
                <Ltr>{r.code}</Ltr>
              </Link>
            </TableCell>
            <TableCell>
              <Ltr>
                {formatDateShort(r.start_date)} - {formatDateShort(r.end_date)}
              </Ltr>
            </TableCell>
            <TableCell>
              <Ltr>{r.route || "-"}</Ltr>
            </TableCell>
            <TableCell>{r.is_published ? "מפורסם" : "טיוטה"}</TableCell>
            <TableCell className="text-muted-foreground">{r.detail ?? ""}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AllocationTable({ rows }: { rows: AllocationProblem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>יציאה</TableHead>
          <TableHead>בלוק</TableHead>
          <TableHead>מושבים</TableHead>
          <TableHead>פירוט</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.allocation_id}>
            <TableCell>
              <Link href={departureHref(r.departure_code)} className={`font-medium ${linkClass}`}>
                <Ltr>{r.departure_code}</Ltr>
              </Link>{" "}
              <Ltr className="text-xs text-muted-foreground">{formatDateShort(r.departure_date)}</Ltr>
            </TableCell>
            <TableCell>
              <Link href={blockHref(r.flight_id)} className={linkClass}>
                <Ltr>{r.flight_route}</Ltr>
              </Link>{" "}
              <Ltr className="text-xs text-muted-foreground">{formatDateShort(r.flight_date)}</Ltr>
            </TableCell>
            <TableCell className="tabular-nums">{r.seats}</TableCell>
            <TableCell className="text-muted-foreground">{r.detail}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BlockTable({ rows }: { rows: BlockProblem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>בלוק</TableHead>
          <TableHead>טיסה</TableHead>
          <TableHead>סטטוס</TableHead>
          <TableHead>פירוט</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.flight_id}>
            <TableCell>
              <Link href={blockHref(r.flight_id)} className={`font-medium ${linkClass}`}>
                <Ltr>
                  {r.airline_code} {r.route}
                </Ltr>
              </Link>
            </TableCell>
            <TableCell>
              <Ltr>{formatDateShort(r.outbound_date)}</Ltr>
            </TableCell>
            <TableCell>{r.status}</TableCell>
            <TableCell className="text-muted-foreground">{r.detail}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
