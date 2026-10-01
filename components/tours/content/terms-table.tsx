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
import { EmptyRows } from "@/components/tours/content/save-bar";
import { TERM_KINDS, TERM_KIND_LABELS, type TermKind, type TermListRow } from "@/components/tours/content/shared";

const isKind = (value: unknown): value is TermKind => TERM_KINDS.includes(value as TermKind);

/** The taxonomies of the site, one kind at a time. */
export function TermsTable({ rows }: { rows: TermListRow[] }) {
  const [kind, setKind] = useSessionState<TermKind>("kind", "destinations", isKind);
  const [query, setQuery] = useSessionState("q", "");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.kind, (map.get(row.kind) ?? 0) + 1);
    return map;
  }, [rows]);

  const shown = useMemo(
    () => rows.filter((r) => r.kind === kind).filter((r) => matchesSearch(query, r.name, r.slug)),
    [rows, kind, query],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-md border bg-background p-0.5 text-sm" role="tablist" aria-label="סוג הקטגוריה">
          {TERM_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn("rounded px-3 py-1.5 text-muted-foreground", kind === k && "bg-muted font-medium text-foreground")}
            >
              {TERM_KIND_LABELS[k]} <span className="text-xs">({counts.get(k) ?? 0})</span>
            </button>
          ))}
        </div>
        <SearchInput value={query} onValueChange={setQuery} placeholder="חיפוש לפי שם או כתובת" />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">מיקום</TableHead>
              <TableHead>שם</TableHead>
              <TableHead>כתובת (slug)</TableHead>
              <TableHead>עמודי טיול</TableHead>
              <TableHead>תמונות ראש</TableHead>
              <TableHead>מצב</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">{row.position}</TableCell>
                <TableCell>
                  <Link href={`/tours/terms/${row.id}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.slug}</TableCell>
                <TableCell>{row.pages > 0 ? row.pages : <span className="text-muted-foreground">0</span>}</TableCell>
                <TableCell>
                  {row.heroImages > 0 ? row.heroImages : <span className="text-muted-foreground">0</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "outline" : "destructive"}>{row.isActive ? "פעיל" : "לא פעיל"}</Badge>
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/terms/${row.id}`} aria-label={`עריכת ${row.name}`} title="עריכה">
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
            title={query ? "אין תוצאות לחיפוש" : `אין ${TERM_KIND_LABELS[kind]} בחברה הזו`}
            description={query ? "נסו חיפוש אחר." : "הקטגוריות נוצרות בטעינת הנתונים של האתר."}
          />
        )}
      </div>
    </div>
  );
}
