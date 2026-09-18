"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { matchesSearch } from "@/lib/search";
import { partnerPageLink } from "@/lib/site";
import type { SitePageOption } from "@/lib/actions/portal-site-pages-actions";
import { CopyField } from "./copy-field";

const PAGE_KIND_LABEL: Record<SitePageOption["kind"], string> = {
  artist: "אמן",
  team: "קבוצה",
  category: "קטגוריה",
};

/**
 * Pick a site page (artist / team / category) and get the partner's tracking
 * link straight to it. Lives on the dashboard and on /portal/packages - it was
 * built on a page the V2 menu no longer reached, so nobody could find it.
 */
export function SitePagePicker({
  trackingCode,
  pages,
  agentUtm,
}: {
  trackingCode: string;
  pages: SitePageOption[];
  agentUtm?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SitePageOption | null>(null);

  const matches = useMemo(
    () =>
      pages
        .filter((page) => matchesSearch(query, page.label, page.label_english))
        .slice(0, 8),
    [pages, query],
  );

  return (
    <div className="space-y-3">
      <Label htmlFor="page-search">לינק לעמוד באתר - אמן, קבוצה או קטגוריה</Label>
      <div className="relative">
        <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="page-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="חיפוש עמוד... (ליברפול, Coldplay, ליגה ספרדית)"
          className="pe-9"
        />
      </div>

      {pages.length === 0 ? (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          רשימת העמודים לא נטענה - רעננו את הדף.
        </p>
      ) : !selected ? (
        <ul className="divide-y rounded-md border">
          {matches.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">לא נמצאו עמודים</li>
          ) : (
            matches.map((page) => (
              <li key={page.path}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-muted"
                  onClick={() => setSelected(page)}
                >
                  <span className="truncate text-sm font-medium">{page.label}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {PAGE_KIND_LABEL[page.kind]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{selected.label}</p>
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {selected.path}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
              שינוי
            </Button>
          </div>
          <CopyField
            label="לינק ישיר לעמוד"
            value={partnerPageLink(trackingCode, selected.path, agentUtm)}
          />
        </div>
      )}
    </div>
  );
}
