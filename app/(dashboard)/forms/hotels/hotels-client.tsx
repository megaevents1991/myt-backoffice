"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUrlState } from "@/hooks/use-view-state";
import { cn } from "@/lib/utils";
import { buildHotelRows, hotelKey, onFive, type HotelRow } from "@/lib/forms/series";
import type { HotelReportAnswer, HotelsReport } from "@/lib/actions/form-hotels-actions";

const PERIODS = ["90", "365", "all"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABEL: Record<Period, string> = {
  "90": "Last 3 months",
  "365": "Last 12 months",
  all: "All time",
};

/** Under 3 needs a call, under 4 needs a look. */
function scoreClass(avg: number): string {
  if (avg < 3) return "bg-red-500/15 text-red-700 dark:text-red-300";
  if (avg < 4) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
}

function dmy(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Jerusalem" });
}

type Row = HotelRow & { seriesText: string };

export function HotelsClient({ report }: { report: HotelsReport }) {
  const [period, setPeriod] = useUrlState<Period>("period", "365", PERIODS);
  const [series, setSeries] = useUrlState<string>("series", "all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const seriesCodes = useMemo(
    () =>
      [...new Set(report.answers.map((a) => a.series).filter((s): s is string => Boolean(s)))].sort(),
    [report.answers],
  );

  const answers = useMemo(() => {
    const since =
      period === "all" ? null : new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString();
    return report.answers.filter(
      (a) => (!since || a.submittedAt >= since) && (series === "all" || a.series === series),
    );
  }, [report.answers, period, series]);

  const rows: Row[] = useMemo(
    () => buildHotelRows(answers).map((row) => ({ ...row, seriesText: row.series.join(" ") })),
    [answers],
  );

  const answersOf = useMemo(() => {
    const map = new Map<string, HotelReportAnswer[]>();
    for (const a of answers) {
      const key = hotelKey(a.city, a.name);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [answers]);

  const formTitle = useMemo(() => new Map(report.forms.map((f) => [f.id, f.title])), [report.forms]);

  const columns: ColumnDef<Row>[] = [
    {
      id: "name",
      accessorFn: (row) => `${row.name} ${row.city}`,
      header: "Hotel",
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <div className="font-medium" dir="auto">
            {row.original.name || <span className="text-muted-foreground">No hotel name</span>}
          </div>
          <div className="text-xs text-muted-foreground" dir="auto">
            {row.original.city || "—"}
          </div>
        </div>
      ),
    },
    {
      id: "avg",
      accessorKey: "avg",
      header: "Average",
      cell: ({ row }) => (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
            scoreClass(row.original.avg),
          )}
        >
          <Star className="h-3.5 w-3.5 fill-current" />
          {row.original.avg.toFixed(2)}
        </span>
      ),
    },
    {
      id: "answers",
      accessorKey: "answers",
      header: "Answers",
      cell: ({ row }) => <span className="tabular-nums">{row.original.answers}</span>,
    },
    {
      id: "spread",
      header: "1★ … 5★",
      enableSorting: false,
      cell: ({ row }) => <Spread spread={row.original.spread} />,
    },
    {
      id: "trips",
      accessorKey: "trips",
      header: "Trips",
      cell: ({ row }) => <span className="tabular-nums">{row.original.trips}</span>,
    },
    {
      id: "seriesText",
      accessorKey: "seriesText",
      header: "Series",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.series.map((code) => (
            <Badge key={code} variant="outline" className="font-mono text-[10px]">
              {code}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "worst",
      accessorFn: (row) => row.worstTrip?.avg ?? 99,
      header: "Weakest trip",
      cell: ({ row }) =>
        row.original.worstTrip ? (
          <span className="whitespace-nowrap text-sm">
            <span className="font-mono">{row.original.worstTrip.code || "—"}</span>{" "}
            <span className="text-muted-foreground">
              {row.original.worstTrip.avg.toFixed(1)} ({row.original.worstTrip.answers})
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "lastAt",
      accessorKey: "lastAt",
      header: "Last answer",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{dmy(row.original.lastAt)}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      {report.truncated && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Only the first answers were read - narrow the period to see the rest correctly.
        </p>
      )}
      <DataTable
        columns={columns}
        data={rows}
        searchColumns={["name", "seriesText"]}
        searchPlaceholder="Search hotel, city or series…"
        defaultSorting={[{ id: "avg", desc: false }]}
        getRowId={(row) => row.key}
        onRowClick={(row) => setExpanded((current) => (current === row.key ? null : row.key))}
        expandedRowId={expanded}
        renderExpandedRow={(row) => (
          <HotelAnswers answers={answersOf.get(row.key) ?? []} formTitle={formTitle} />
        )}
        filters={
          <div className="flex flex-wrap gap-2">
            <Select value={period} onValueChange={(next) => setPeriod(next as Period)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={series} onValueChange={setSeries}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[50vh]">
                <SelectItem value="all">All series</SelectItem>
                {seriesCodes.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        emptyState={{
          title: "No hotel answers yet",
          description:
            "Add a hotel question (Add question → Hotel rating) to a series form. Its answers show up here by hotel.",
        }}
        dense
      />
    </div>
  );
}

/** How many answers gave 1..5 stars - a hotel at 3.8 with five 1-star answers is not fine. */
function Spread({ spread }: { spread: number[] }) {
  const top = Math.max(1, ...spread);
  return (
    <div
      className="flex h-6 items-end gap-0.5"
      aria-label={spread.map((n, i) => `${i + 1}★ ${n}`).join(", ")}
    >
      {spread.map((n, i) => (
        <div
          key={i}
          title={`${i + 1}★: ${n}`}
          className={cn(
            "w-2.5 rounded-sm",
            i < 2 ? "bg-red-400" : i === 2 ? "bg-amber-400" : "bg-emerald-400",
          )}
          style={{ height: `${Math.max(8, (n / top) * 100)}%`, opacity: n === 0 ? 0.2 : 1 }}
        />
      ))}
    </div>
  );
}

/** The hotel's answers, the lowest first - with what the traveller wrote, to know why. */
function HotelAnswers({
  answers,
  formTitle,
}: {
  answers: HotelReportAnswer[];
  formTitle: Map<number, string>;
}) {
  const sorted = [...answers]
    .sort(
      (a, b) =>
        onFive(a.value, a.max) - onFive(b.value, b.max) || b.submittedAt.localeCompare(a.submittedAt),
    )
    .slice(0, 40);

  return (
    <div className="space-y-1.5 bg-muted/30 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {answers.length} answers, lowest first
        {answers.length > sorted.length ? ` (first ${sorted.length})` : ""}.
      </p>
      {sorted.map((a) => (
        <div
          key={`${a.responseId}-${a.fieldId}`}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 text-xs font-semibold tabular-nums",
              scoreClass(onFive(a.value, a.max)),
            )}
          >
            <Star className="h-3 w-3 fill-current" />
            {a.value}/{a.max}
          </span>
          <span className="font-mono text-xs">{a.tripCode ?? "no trip link"}</span>
          <span className="text-xs text-muted-foreground">{dmy(a.submittedAt)}</span>
          <Link
            href={`/forms/${a.formId}/report`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {formTitle.get(a.formId) ?? `Form #${a.formId}`}
          </Link>
          {a.note && (
            <p className="basis-full text-sm" dir="auto">
              “{a.note}”
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
