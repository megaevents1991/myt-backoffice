"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { FileDown, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { updateQuoteStatus } from "@/lib/actions/quote-actions";
import type {
  PartnerQuoteStatus,
  PortalQuoteStats,
  PortalQuoteWithState,
} from "@/lib/actions/quote-actions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const STATUS_LABELS: Record<PartnerQuoteStatus, string> = {
  final: "פתוחה",
  closed: "נסגרה",
  not_relevant: "לא רלוונטי",
};

/** Recompute the tile numbers after a local status change - same rules as the
 *  server's getPortalQuotesOverview. */
function computeStats(quotes: PortalQuoteWithState[]): PortalQuoteStats {
  const today = new Date().toISOString().slice(0, 10);
  return quotes.reduce(
    (acc, quote) => {
      const pastValidity = !!quote.valid_until && quote.valid_until.slice(0, 10) < today;
      acc.total += 1;
      if (quote.closed_by_order || quote.status === "closed") acc.closed += 1;
      else if (quote.status === "not_relevant") acc.notRelevant += 1;
      else if (pastValidity) acc.expired += 1;
      else acc.openForFollowUp += 1;
      return acc;
    },
    { total: 0, closed: 0, expired: 0, notRelevant: 0, openForFollowUp: 0 }
  );
}

const pct = (part: number, total: number) =>
  total > 0 ? `${Math.round((part / total) * 100)}%` : "-";

export function QuotesClient({
  initialQuotes,
  stats: initialStats,
  isManager = false,
}: {
  initialQuotes: PortalQuoteWithState[];
  stats: PortalQuoteStats;
  /** Managers get a "נוצר ע"י" column - agents in a multi-user office only
   *  ever see their own quotes, so it would be redundant for them. */
  isManager?: boolean;
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [quotes, setQuotes] = useState(initialQuotes);

  const stats = useMemo(
    () => (quotes === initialQuotes ? initialStats : computeStats(quotes)),
    [quotes, initialQuotes, initialStats]
  );

  const handleStatusChange = (id: number, status: PartnerQuoteStatus) => {
    const previous = quotes;
    // Optimistic - the list is the agent's own data and the change is tiny.
    setQuotes((current) =>
      current.map((q) => (q.id === id ? { ...q, status } : q))
    );
    startTransition(async () => {
      const result = await updateQuoteStatus(id, status);
      if (!result.ok) {
        setQuotes(previous);
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
      }
    });
  };

  const handleDownloadPdf = (id: number) => {
    setDownloadingId(id);
    // Open the tab synchronously in the click handler - popup blockers
    // (Safari especially) kill window.open calls made after an await.
    const win = window.open("", "_blank");
    startTransition(async () => {
      const fail = () => {
        win?.close();
        toast({
          variant: "destructive",
          title: "שגיאה",
          description: "יצירת ה-PDF נכשלה, נסה שוב",
        });
      };
      try {
        // /portal-path alias - the partner session cookie is path-scoped to
        // /portal and never reaches /api/* (multi-session).
        const res = await fetch(`/portal/api/quotes/${id}/pdf`, { method: "POST" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          fail();
          return;
        }
        if (win) {
          win.location.href = data.url;
        } else {
          // Placeholder tab was blocked - try a direct open, and if that is
          // blocked too, surface the URL so the user can open it manually.
          const fallback = window.open(data.url, "_blank");
          if (!fallback) {
            toast({
              title: "ה-PDF מוכן",
              description: `חסימת חלונות קופצים מנעה פתיחה אוטומטית - פתח ידנית: ${data.url}`,
            });
          }
        }
      } catch {
        fail();
      } finally {
        setDownloadingId(null);
      }
    });
  };

  const tiles = [
    { label: "סה\"כ הצעות", value: String(stats.total), hint: null },
    { label: "נסגרו", value: String(stats.closed), hint: pct(stats.closed, stats.total) },
    { label: "פג תוקפן", value: String(stats.expired), hint: pct(stats.expired, stats.total) },
    {
      label: "לא רלוונטי",
      value: String(stats.notRelevant),
      hint: pct(stats.notRelevant, stats.total),
    },
    {
      label: "ממתינות למעקב",
      value: String(stats.openForFollowUp),
      hint: pct(stats.openForFollowUp, stats.total),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">הצעות מחיר</h1>
        <Button asChild>
          <Link href="/portal/quotes/new">
            <PlusCircle className="ml-2 h-4 w-4" />
            הצעה חדשה
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.label} className="shadow-card">
            <CardHeader className="space-y-0 pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {tile.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold tabular-nums">
                {tile.value}
              </span>
              {tile.hint && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tile.hint}
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {quotes.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          אין הצעות מחיר עדיין
        </div>
      ) : (
        <div className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מספר</TableHead>
                <TableHead>תאריך</TableHead>
                <TableHead>לקוח</TableHead>
                <TableHead>כותרת</TableHead>
                <TableHead>סה&quot;כ ($)</TableHead>
                <TableHead>בתוקף עד</TableHead>
                <TableHead>סטטוס</TableHead>
                {isManager && <TableHead>{'נוצר ע"י'}</TableHead>}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell className="font-medium">{quote.id}</TableCell>
                  <TableCell>
                    {new Date(quote.created_at).toLocaleDateString("he-IL")}
                  </TableCell>
                  <TableCell>{quote.customer_name || "-"}</TableCell>
                  <TableCell>{quote.title || "-"}</TableCell>
                  <TableCell>{quote.total != null ? usd.format(quote.total) : "-"}</TableCell>
                  <TableCell>
                    {quote.valid_until
                      ? new Date(quote.valid_until).toLocaleDateString("he-IL")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {quote.closed_by_order ? (
                      <Badge>נסגרה · הוזמן באתר</Badge>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={
                            (["final", "closed", "not_relevant"] as const).includes(
                              quote.status as PartnerQuoteStatus
                            )
                              ? quote.status
                              : "final"
                          }
                          onValueChange={(v) =>
                            handleStatusChange(quote.id, v as PartnerQuoteStatus)
                          }
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(STATUS_LABELS) as PartnerQuoteStatus[]).map(
                              (value) => (
                                <SelectItem key={value} value={value}>
                                  {STATUS_LABELS[value]}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        {quote.expired && quote.status === "final" && (
                          <Badge variant="destructive" className="whitespace-nowrap">
                            פג תוקף
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  {isManager && (
                    <TableCell>{quote.creator_name ?? "-"}</TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending && downloadingId === quote.id}
                      onClick={() => handleDownloadPdf(quote.id)}
                    >
                      <FileDown className="ml-2 h-4 w-4" />
                      {isPending && downloadingId === quote.id ? "מוריד..." : "הורד PDF"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
