"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileDown, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import type { PortalQuote } from "@/lib/actions/quote-actions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function statusBadgeVariant(status: string) {
  if (status === "final") return "default" as const;
  return "outline" as const;
}

export function QuotesClient({ initialQuotes }: { initialQuotes: PortalQuote[] }) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleDownloadPdf = (id: number) => {
    setDownloadingId(id);
    // Open the tab synchronously in the click handler — popup blockers
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
        // /portal-path alias — the partner session cookie is path-scoped to
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
          // Placeholder tab was blocked — try a direct open, and if that is
          // blocked too, surface the URL so the user can open it manually.
          const fallback = window.open(data.url, "_blank");
          if (!fallback) {
            toast({
              title: "ה-PDF מוכן",
              description: `חסימת חלונות קופצים מנעה פתיחה אוטומטית — פתח ידנית: ${data.url}`,
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

      {initialQuotes.length === 0 ? (
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialQuotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell className="font-medium">{quote.id}</TableCell>
                  <TableCell>
                    {new Date(quote.created_at).toLocaleDateString("he-IL")}
                  </TableCell>
                  <TableCell>{quote.customer_name || "—"}</TableCell>
                  <TableCell>{quote.title || "—"}</TableCell>
                  <TableCell>{quote.total != null ? usd.format(quote.total) : "—"}</TableCell>
                  <TableCell>
                    {quote.valid_until
                      ? new Date(quote.valid_until).toLocaleDateString("he-IL")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(quote.status)}>{quote.status}</Badge>
                  </TableCell>
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
