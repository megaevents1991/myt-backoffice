"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/search-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSessionState } from "@/hooks/use-view-state";
import { matchesSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { SiteImage } from "@/components/tours/content/fields";
import { EmptyRows } from "@/components/tours/content/save-bar";
import {
  PACKAGE_BRAND_COLORS,
  packageKindLabel,
  type PackageBrand,
  type PackageListRow,
} from "@/components/tours/content/shared";

type View = "content" | "stubs" | "all";
const VIEWS: View[] = ["content", "stubs", "all"];
const isView = (value: unknown): value is View => VIEWS.includes(value as View);

/**
 * The trip pages of the site. Pages the import created only so a series has a
 * home ("stubs") carry no content - they are hidden by default.
 */
export function PackagesTable({ rows, siteUrl }: { rows: PackageListRow[]; siteUrl: string | null }) {
  const [view, setView] = useSessionState<View>("view", "content", isView);
  const [query, setQuery] = useSessionState("q", "");

  const counts = useMemo(
    () => ({
      content: rows.filter((r) => r.hasContent).length,
      stubs: rows.filter((r) => !r.hasContent).length,
      all: rows.length,
    }),
    [rows],
  );
  const labels: Record<View, string> = { content: "עם תוכן", stubs: "ללא תוכן", all: "הכל" };

  const shown = useMemo(
    () =>
      rows
        .filter((r) => (view === "all" ? true : view === "content" ? r.hasContent : !r.hasContent))
        .filter((r) => matchesSearch(query, r.name, r.subtitle, r.slug, r.seriesCodes.join(" "))),
    [rows, view, query],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border bg-background p-0.5 text-sm" role="tablist" aria-label="סינון לפי תוכן">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-3 py-1.5 text-muted-foreground",
                view === v && "bg-muted font-medium text-foreground",
              )}
            >
              {labels[v]} <span className="text-xs">({counts[v]})</span>
            </button>
          ))}
        </div>
        <SearchInput value={query} onValueChange={setQuery} placeholder="חיפוש לפי שם, כתובת או קוד סדרה" />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px]">תמונה</TableHead>
              <TableHead>שם העמוד</TableHead>
              <TableHead>סוג</TableHead>
              <TableHead>סדרות</TableHead>
              <TableHead>יציאות עתידיות באתר</TableHead>
              <TableHead>תוכן</TableHead>
              <TableHead>מצב</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <SiteImage siteUrl={siteUrl} path={row.cardImage} className="h-10 w-14" alt={row.name} />
                </TableCell>
                <TableCell>
                  <Link href={`/tours/packages/${row.id}`} className="font-medium hover:underline">
                    <span
                      aria-hidden
                      className="me-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ backgroundColor: PACKAGE_BRAND_COLORS[row.brand as PackageBrand] ?? "#9ca3af" }}
                    />
                    {row.name}
                  </Link>
                  {row.subtitle && <div className="text-xs text-muted-foreground">{row.subtitle}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{packageKindLabel(row.kind)}</TableCell>
                <TableCell>
                  {row.seriesCodes.length ? (
                    <div className="flex flex-wrap gap-1" dir="ltr">
                      {row.seriesCodes.map((code) => (
                        <Badge key={code} variant="secondary" className="font-mono text-[11px]">
                          {code}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">אין</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.futurePublished > 0 ? (
                    <span className="font-medium">{row.futurePublished}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.hasContent ? (
                    <Badge variant="outline">יש תוכן</Badge>
                  ) : (
                    <Badge variant="secondary">ללא תוכן</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "outline" : "destructive"}>{row.isActive ? "פעיל" : "לא פעיל"}</Badge>
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/packages/${row.id}`} aria-label={`עריכת ${row.name}`} title="עריכה">
                      <Pencil />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {shown.length === 0 && (
          <EmptyRows
            title={rows.length === 0 ? "עוד אין עמודי טיול" : "אין עמודים שמתאימים לסינון"}
            description={
              rows.length === 0
                ? "עמודי הטיול נוצרים בטעינת הנתונים של החברה."
                : view === "content" && counts.stubs > 0
                  ? `יש ${counts.stubs} עמודים ללא תוכן. הם מוצגים בלשונית "ללא תוכן".`
                  : "נסו חיפוש אחר או לשונית אחרת."
            }
          />
        )}
      </div>
    </div>
  );
}
