"use client";

/**
 * V2 merged הצעות table (2026-08-27 spec): quotes AND package links live in
 * ONE table - "אין יותר הפרדה אם זה לינק או PDF". The תאריך column is a
 * follow-up date the agent picks per row (falls back to the creation date),
 * and every row carries its actions: quotes keep status + PDF, package rows
 * get הזמן (agent handoff to main) / שלח הצעה / copy link.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileDown,
  FileText,
  PlusCircle,
} from "lucide-react";
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
import {
  updateQuoteStatus,
  updateQuoteFollowUp,
} from "@/lib/actions/quote-actions";
import type {
  PartnerQuoteStatus,
  PortalQuoteStats,
  PortalQuoteWithState,
} from "@/lib/actions/quote-actions";
import {
  getAgentOrderHandoffLink,
  setPackageFollowUp,
  type PreparedPackageListItem,
} from "@/lib/actions/portal-package-actions";

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

const dateOnly = (value: string | null | undefined): string =>
  value ? value.slice(0, 10) : "";

type MergedRow =
  | { kind: "quote"; key: string; followUp: string; quote: PortalQuoteWithState }
  | { kind: "package"; key: string; followUp: string; pkg: PreparedPackageListItem };

export function QuotesClient({
  initialQuotes,
  stats: initialStats,
  packages: initialPackages,
  isManager = false,
}: {
  initialQuotes: PortalQuoteWithState[];
  stats: PortalQuoteStats;
  /** V2: the package links live in the same table. */
  packages: PreparedPackageListItem[];
  /** Managers get a "נוצר ע"י" column - agents in a multi-user office only
   *  ever see their own quotes, so it would be redundant for them. */
  isManager?: boolean;
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [handoffId, setHandoffId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [quotes, setQuotes] = useState(initialQuotes);
  const [packages, setPackages] = useState(initialPackages);

  const stats = useMemo(
    () => (quotes === initialQuotes ? initialStats : computeStats(quotes)),
    [quotes, initialQuotes, initialStats]
  );

  const rows = useMemo<MergedRow[]>(() => {
    const quoteRows: MergedRow[] = quotes.map((quote) => ({
      kind: "quote",
      key: `q-${quote.id}`,
      followUp: dateOnly(quote.follow_up_date) || dateOnly(quote.created_at),
      quote,
    }));
    const packageRows: MergedRow[] = packages.map((pkg) => ({
      kind: "package",
      key: `p-${pkg.id}`,
      followUp: dateOnly(pkg.follow_up_date) || dateOnly(pkg.created_at),
      pkg,
    }));
    // One list, newest follow-up first - the agent works it top-down.
    return [...quoteRows, ...packageRows].sort((a, b) =>
      b.followUp.localeCompare(a.followUp)
    );
  }, [quotes, packages]);

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

  const handleFollowUpChange = (row: MergedRow, value: string) => {
    const date = value || null;
    if (row.kind === "quote") {
      const previous = quotes;
      setQuotes((current) =>
        current.map((q) =>
          q.id === row.quote.id ? { ...q, follow_up_date: date } : q
        )
      );
      startTransition(async () => {
        const result = await updateQuoteFollowUp(row.quote.id, date);
        if (!result.ok) {
          setQuotes(previous);
          toast({ variant: "destructive", title: "שגיאה", description: result.error });
        }
      });
    } else {
      const previous = packages;
      setPackages((current) =>
        current.map((p) =>
          p.id === row.pkg.id ? { ...p, follow_up_date: date } : p
        )
      );
      startTransition(async () => {
        const result = await setPackageFollowUp(row.pkg.id, date);
        if (!result.ok) {
          setPackages(previous);
          toast({ variant: "destructive", title: "שגיאה", description: result.error });
        }
      });
    }
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

  /** "הזמן" on a package row - main's order flow with a live agent session
   *  (the settlement buttons are already open there). Popup-blocker-safe. */
  const handleOrder = (packageId: number) => {
    setHandoffId(packageId);
    const win = window.open("about:blank", "_blank");
    startTransition(async () => {
      const result = await getAgentOrderHandoffLink(packageId);
      if (!result.ok) {
        win?.close();
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
      } else if (win) {
        win.location.href = result.url;
      } else {
        window.open(result.url, "_blank");
      }
      setHandoffId(null);
    });
  };

  const handleCopyLink = async (pkg: PreparedPackageListItem) => {
    try {
      await navigator.clipboard.writeText(pkg.link);
      setCopiedId(pkg.id);
      setTimeout(() => setCopiedId((prev) => (prev === pkg.id ? null : prev)), 2000);
    } catch {
      toast({ variant: "destructive", title: "ההעתקה נכשלה" });
    }
  };

  const tiles = [
    { label: "סה\"כ הצעות", value: String(stats.total), hint: null },
    { label: "לינקים וחבילות", value: String(packages.length), hint: null },
    { label: "נסגרו", value: String(stats.closed), hint: pct(stats.closed, stats.total) },
    { label: "פג תוקפן", value: String(stats.expired), hint: pct(stats.expired, stats.total) },
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
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/portal/packages/new">בניית חבילה</Link>
          </Button>
          <Button asChild>
            <Link href="/portal/quotes/new">
              <PlusCircle className="ml-2 h-4 w-4" />
              הצעה חדשה
            </Link>
          </Button>
        </div>
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

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          אין עדיין הצעות, לינקים או חבילות
        </div>
      ) : (
        <div className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מספר</TableHead>
                <TableHead>תאריך פולו-אפ</TableHead>
                <TableHead>לקוח</TableHead>
                <TableHead>כותרת</TableHead>
                <TableHead>סה&quot;כ ($)</TableHead>
                <TableHead>סטטוס</TableHead>
                {isManager && <TableHead>{'נוצר ע"י'}</TableHead>}
                <TableHead>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">
                    {row.kind === "quote" ? row.quote.id : `P-${row.pkg.id}`}
                  </TableCell>
                  <TableCell>
                    <input
                      type="date"
                      dir="ltr"
                      value={row.followUp}
                      onChange={(e) => handleFollowUpChange(row, e.target.value)}
                      aria-label="תאריך פולו-אפ"
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </TableCell>
                  {row.kind === "quote" ? (
                    <>
                      <TableCell>{row.quote.customer_name || "-"}</TableCell>
                      <TableCell>{row.quote.title || "-"}</TableCell>
                      <TableCell>
                        {row.quote.total != null ? usd.format(row.quote.total) : "-"}
                      </TableCell>
                      <TableCell>
                        {row.quote.closed_by_order ? (
                          <Badge>נסגרה · הוזמן באתר</Badge>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={
                                (["final", "closed", "not_relevant"] as const).includes(
                                  row.quote.status as PartnerQuoteStatus
                                )
                                  ? row.quote.status
                                  : "final"
                              }
                              onValueChange={(v) =>
                                handleStatusChange(row.quote.id, v as PartnerQuoteStatus)
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
                            {row.quote.expired && row.quote.status === "final" && (
                              <Badge variant="destructive" className="whitespace-nowrap">
                                פג תוקף
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      {isManager && (
                        <TableCell>{row.quote.creator_name ?? "-"}</TableCell>
                      )}
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending && downloadingId === row.quote.id}
                          onClick={() => handleDownloadPdf(row.quote.id)}
                        >
                          <FileDown className="ml-2 h-4 w-4" />
                          {isPending && downloadingId === row.quote.id
                            ? "מוריד..."
                            : "הורד PDF"}
                        </Button>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>-</TableCell>
                      <TableCell className="max-w-64">
                        <span className="block truncate">
                          {row.pkg.event_name}
                          {row.pkg.category &&
                            ` · ${row.pkg.qty} × ${row.pkg.category}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.pkg.price_per_person != null
                          ? usd.format(row.pkg.price_per_person * row.pkg.qty)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="whitespace-nowrap">
                          {row.pkg.allow_edit ? "לינק · פתוח לעריכה" : "לינק · נעול"}
                        </Badge>
                      </TableCell>
                      {isManager && (
                        <TableCell>{row.pkg.creator_name ?? "-"}</TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            disabled={handoffId === row.pkg.id}
                            onClick={() => handleOrder(row.pkg.id)}
                            className="bg-brand-forest text-white hover:bg-brand-forest/90"
                          >
                            <ExternalLink className="ml-1 h-3.5 w-3.5" />
                            הזמן
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/portal/quotes/new?package=${row.pkg.id}`}>
                              <FileText className="ml-1 h-3.5 w-3.5" />
                              שלח הצעה
                            </Link>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyLink(row.pkg)}
                          >
                            {copiedId === row.pkg.id ? (
                              <Check className="ml-1 h-3.5 w-3.5" />
                            ) : (
                              <Copy className="ml-1 h-3.5 w-3.5" />
                            )}
                            {copiedId === row.pkg.id ? "הועתק" : "העתק לינק"}
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
