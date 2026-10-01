"use client";

/**
 * Series (/tours/series): the list of the company's series with their route
 * pattern and defaults, the edit form, and the entry point to season
 * duplication.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Pencil, Plus, RefreshCw, Shuffle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { Chip, Ltr, Notice, selectClass } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUrlState } from "@/hooks/use-view-state";
import { matchesSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { WEEKDAY_SHORT } from "@/lib/tours/format";
import { ROUTE_TYPE_LABELS, routeType } from "@/lib/tours/routes";
import { getSeriesScreen } from "@/lib/actions/tours-series-actions";
import { SeasonDialog } from "./season-dialog";
import { SeriesForm } from "./series-form";
import type { SeriesListRow, SeriesScreenData, SeriesTermKind } from "./types";

const th = "sticky top-0 z-10 h-9 whitespace-nowrap bg-muted px-2 text-start text-xs font-semibold text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]";
const td = "px-2 py-2 align-middle";

const TERM_STYLES: Record<SeriesTermKind, string> = {
  audiences: "border-info/30 bg-info-muted text-info",
  tags: "",
  destinations: "border-success/30 bg-success-muted text-success",
};

function End({ airport, weekday }: { airport: string | null; weekday: number | null }) {
  if (!airport && weekday == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap">
      <Ltr className="font-mono text-xs font-semibold">{airport ?? "?"}</Ltr>
      {weekday != null && <span className="ms-1 text-xs text-muted-foreground">{WEEKDAY_SHORT[weekday]}</span>}
    </span>
  );
}

export function SeriesScreen() {
  const [data, setData] = useState<SeriesScreenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useUrlState<string>("q", "");
  const [activeOnly, setActiveOnly] = useUrlState<string>("active", "");
  const [pageId, setPageId] = useUrlState<string>("page", "");
  const [editing, setEditing] = useState<SeriesListRow | "new" | null>(null);
  const [season, setSeason] = useState<SeriesListRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getSeriesScreen();
    if (result.success) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const packageName = useMemo(() => new Map((data?.packages ?? []).map((p) => [p.id, p.name])), [data]);
  const termById = useMemo(() => new Map((data?.terms ?? []).map((t) => [t.id, t])), [data]);

  const rows = useMemo(
    () =>
      (data?.series ?? []).filter((s) => {
        if (activeOnly === "1" && !s.is_active) return false;
        if (pageId && s.package_id !== pageId) return false;
        return matchesSearch(query, s.code, s.label, s.package_id ? packageName.get(s.package_id) : null);
      }),
    [data, query, activeOnly, pageId, packageName],
  );

  const usedPackages = useMemo(() => {
    const ids = new Set((data?.series ?? []).map((s) => s.package_id));
    return (data?.packages ?? []).filter((p) => ids.has(p.id));
  }, [data]);

  return (
    <div className="min-w-0">
      <PageHeader
        title="Series"
        description="A series is the repeating pattern of a tour: code, tour page, arrival city and day, return city and day, and the defaults for a new departure. Season duplication starts here."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/tours/departures">Tours</Link>
            </Button>
            <Button size="sm" onClick={() => setEditing("new")} disabled={!data}>
              <Plus />
              New Series
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          dir="auto"
          aria-label="Search series"
          placeholder="Search by code, name or tour page"
          wrapperClassName="sm:w-64"
          value={query}
          onValueChange={setQuery}
        />
        <select aria-label="Tour page" className={cn(selectClass, "max-w-64")} value={pageId} onChange={(e) => setPageId(e.target.value)}>
          <option value="">All tour pages</option>
          {usedPackages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            checked={activeOnly === "1"}
            onChange={(e) => setActiveOnly(e.target.checked ? "1" : "")}
          />
          Active only
        </label>
        <span className="text-sm text-muted-foreground">
          {loading && !data ? "Loading…" : `${rows.length} of ${data?.series.length ?? 0} series`}
        </span>
        <Button variant="ghost" size="sm" className="ms-auto h-7 text-xs" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? (
        <Notice tone="error" className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try Again
          </Button>
        </Notice>
      ) : (
        <div className="max-h-[calc(100vh-15rem)] min-h-64 overflow-auto rounded-lg border bg-card" data-testid="series-table">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={cn(th, "ps-3")}>Code</th>
                <th className={th}>Internal name</th>
                <th className={th}>Tour page</th>
                <th className={th}>Arrival</th>
                <th className={th}>Return</th>
                <th className={cn(th, "text-center")}>Nights</th>
                <th className={cn(th, "text-center")}>Capacity</th>
                <th className={cn(th, "text-center")}>Currency</th>
                <th className={th}>Ages</th>
                <th className={th}>Audience, tags and destinations</th>
                <th className={cn(th, "text-center")}>Departures</th>
                <th className={cn(th, "pe-3")} />
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={12} className="border-b px-3 py-2">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-16 text-center text-muted-foreground">
                    {data?.series.length ? "No series match the search." : "No series yet. Create the first one."}
                  </td>
                </tr>
              ) : (
                rows.map((s) => {
                  const type = routeType(s.arrival_airport, s.return_airport);
                  const terms = s.termIds.map((id) => termById.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
                  return (
                    <tr
                      key={s.id}
                      data-series={s.code}
                      className={cn("cursor-pointer border-b text-[13px] hover:bg-muted/50", !s.is_active && "text-muted-foreground")}
                      onClick={() => setEditing(s)}
                    >
                      <td className={cn(td, "ps-3")}>
                        <Ltr className="font-mono text-sm font-bold">{s.code}</Ltr>
                        {!s.is_active && <Chip className="ms-2">Inactive</Chip>}
                      </td>
                      <td className={td}>{s.label ?? ""}</td>
                      <td className={cn(td, "max-w-56 truncate")} title={s.package_id ? packageName.get(s.package_id) : undefined}>
                        {s.package_id ? (packageName.get(s.package_id) ?? "Tour page not found") : <span className="text-destructive">No tour page</span>}
                      </td>
                      <td className={td}>
                        <End airport={s.arrival_airport} weekday={s.arrival_weekday} />
                      </td>
                      <td className={cn(td, "whitespace-nowrap")}>
                        <End airport={s.return_airport} weekday={s.return_weekday} />
                        {type === "open_jaw" && (
                          <span
                            title={ROUTE_TYPE_LABELS.open_jaw}
                            aria-label={ROUTE_TYPE_LABELS.open_jaw}
                            className="ms-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-info/30 bg-info-muted align-middle text-info"
                          >
                            <Shuffle className="h-3 w-3" />
                          </span>
                        )}
                      </td>
                      <td className={cn(td, "text-center tabular-nums")}>{s.default_nights ?? "—"}</td>
                      <td className={cn(td, "text-center tabular-nums")}>{s.default_capacity ?? "—"}</td>
                      <td className={cn(td, "text-center text-xs")}>
                        <Ltr>{s.default_currency}</Ltr>
                      </td>
                      <td className={cn(td, "whitespace-nowrap text-xs")}>
                        <span title="Child up to age">Child up to {s.child_max_age}</span>
                        {s.senior_min_age != null && (
                          <span className="block text-muted-foreground" title="Senior from age, and senior discount">
                            Senior {s.senior_min_age}+{s.senior_discount != null ? ` · discount ${s.senior_discount}` : ""}
                          </span>
                        )}
                      </td>
                      <td className={cn(td, "min-w-64")}>
                        <span className="flex flex-wrap gap-1">
                          {terms.map((t) => (
                            <Chip key={t.id} className={TERM_STYLES[t.kind]}>
                              {t.name}
                            </Chip>
                          ))}
                        </span>
                      </td>
                      <td className={cn(td, "whitespace-nowrap text-center")} onClick={(e) => e.stopPropagation()}>
                        {s.departures > 0 ? (
                          <Link
                            href={`/tours/departures?series=${s.code}&year=all`}
                            className="font-semibold tabular-nums underline-offset-2 hover:underline"
                            title="Open this series' departures in Tours"
                          >
                            {s.departures}
                            {s.upcoming > 0 && <span className="ms-1 text-xs font-normal text-success">({s.upcoming} upcoming)</span>}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className={cn(td, "whitespace-nowrap pe-3 text-end")} onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setSeason(s)} title="Propose a season of departures from the series pattern">
                          <CalendarPlus />
                          Duplicate Season
                        </Button>
                        <Button variant="ghost" size="icon" className="ms-1 h-8 w-8" onClick={() => setEditing(s)} title="Edit series">
                          <Pencil />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <>
          <SeriesForm target={editing} packages={data.packages} terms={data.terms} onClose={() => setEditing(null)} onSaved={() => void load()} />
          <SeasonDialog series={season} periods={data.periods} onClose={() => setSeason(null)} onCreated={() => void load()} />
        </>
      )}
    </div>
  );
}
