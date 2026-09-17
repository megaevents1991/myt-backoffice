"use client";

// Side-by-side for ONE event: our package against every competitor's, component by component, in the
// partner's format (2026-09-14): "טיסות: אל על עם מזוודה ישיר 16-20 | מלון: שם מלון כולל ארוחת בוקר או
// ללא | סוג כרטיס". Loaded on demand - detail pages are long, the list never carries them.
import { useCallback, useEffect, useState } from "react";
import { BedDouble, ExternalLink, Loader2, Percent, Plane, RefreshCw, Ticket } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getPriceLightComparison, refreshOurOffer } from "@/lib/actions/price-light-actions";
import { signedUsd } from "@/lib/services/price-light";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "@/lib/services/price-margins";
import { COMPETITOR_LABEL, PILL } from "@/app/(dashboard)/events/price-light-ui";
import type { ComparisonOffer, PriceLightComparison, Scope } from "@/types/price-light.types";

const SCOPE_HE: Record<Scope, string> = { package: "חבילה", ticket: "כרטיס בלבד" };

const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", ILS: "₪" };

function money(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null;
  const sign = CURRENCY_SIGN[currency ?? "USD"] ?? `${currency} `;
  return `${sign}${Math.round(amount).toLocaleString("en-US")}`;
}

function dayMonth(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : null;
}

/** Why a competitor shows no price - said plainly, never as a blank. */
function statusText(o: ComparisonOffer): string | null {
  if (o.who === "ours" || o.normalized_usd != null) return null;
  if (o.quote_only) return "מוכר · הצעת מחיר בלבד";
  switch (o.status) {
    case "not_selling": return "לא מוכר את האירוע";
    case "unsure": return "לא ודאי שזה אותו אירוע";
    case "na": return "לא רלוונטי";
    case "skipped": return "לא נבדק (לא מכוסה / סריקה נכשלה)";
    default: return "ללא מחיר";
  }
}

function Line({ icon: Icon, label, text }: { icon: typeof Plane; label: string; text: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0", !text && "text-muted-foreground")}>{text ?? "לא פורסם"}</span>
    </div>
  );
}

function OfferCard({ offer, scope }: { offer: ComparisonOffer; scope: Scope }) {
  const ours = offer.who === "ours";
  const name = offer.who === "ours" ? "אנחנו" : COMPETITOR_LABEL[offer.who] ?? offer.who;
  const published = !ours ? money(offer.raw, offer.raw_currency) : null;
  const status = statusText(offer);
  const travel = [dayMonth(offer.depart), dayMonth(offer.return)].filter(Boolean).join("–");
  // A competitor with no answer at all has nothing to lay side by side - one muted line is enough.
  const empty = !ours && !offer.title && offer.normalized_usd == null && !offer.quote_only;

  return (
    <div className={cn("rounded-lg border p-3 text-xs", ours && "border-primary/60 bg-primary/5", empty && "py-2")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {offer.decided && <span className="text-muted-foreground" title="קבע את האור">●</span>}
          <span className="text-sm font-semibold">{name}</span>
          {offer.url && (
            <a href={offer.url} target="_blank" rel="noreferrer" title="לצפייה בדף המתחרה" className="self-center">
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          )}
          {offer.multi_match && (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              חבילה מרובת משחקים
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 tabular-nums">
          {offer.normalized_usd != null && <span className="text-sm font-semibold">${offer.normalized_usd.toLocaleString("en-US")}</span>}
          {published && offer.raw_currency !== "USD" && <span className="text-muted-foreground">({published})</span>}
          {offer.light && offer.diff_usd != null && (
            <span className={cn("rounded-full px-1.5 py-0.5 font-medium", PILL[offer.light])} title="המחיר שלנו פחות שלהם, מנורמל">
              {signedUsd(offer.diff_usd)}
            </span>
          )}
        </div>
      </div>

      {/* Our headline is the margin-free "from" price the light compares; the site price is not. */}
      {ours && offer.site_usd != null && (
        <div className="mt-0.5 text-end text-muted-foreground tabular-nums">
          באתר ${offer.site_usd.toLocaleString("en-US")} (כולל +${FLIGHT_MARGIN_USD}/+${HOTEL_MARGIN_USD})
        </div>
      )}

      {status && <div className="mt-1 text-muted-foreground">{status}</div>}

      {!empty && (
        <div className="mt-2 space-y-1">
          {offer.title && !ours && <div className="truncate text-muted-foreground" title={offer.title}>{offer.title}</div>}
          {scope === "package" && (
            <>
              <Line icon={Plane} label="טיסה" text={offer.lines.flight} />
              <Line icon={BedDouble} label="מלון" text={offer.lines.hotel} />
            </>
          )}
          <Line icon={Ticket} label="כרטיס" text={offer.lines.ticket} />
          {ours && scope === "package" && offer.markup_usd != null && (
            <Line icon={Percent} label="עמלות" text={`מארקאפ האתר · $${offer.markup_usd.toLocaleString("en-US")}`} />
          )}
          {scope === "package" && (travel || offer.nights != null) && (
            <div className="text-muted-foreground">
              {travel}
              {offer.nights != null ? `${travel ? " · " : ""}${offer.nights} לילות` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ComparisonSheet({
  eventId,
  eventName,
  open,
  onOpenChange,
}: {
  eventId: number;
  eventName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<PriceLightComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getPriceLightComparison(eventId));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await refreshOurOffer(eventId);
      if (!res.ok) {
        toast({ variant: "destructive", title: "הפירוט נכשל", description: res.error });
        return;
      }
      setData(res.comparison);
      const errors = res.comparison.ours_errors;
      toast({
        title: errors.length ? "פורט חלקית" : "הפירוט שלנו עודכן",
        description: errors.length ? errors.join(" · ") : undefined,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const scopes = (["package", "ticket"] as const).filter((s) => (data?.[s].length ?? 0) > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="space-y-1 text-start">
          <SheetTitle>השוואה · {eventName}</SheetTitle>
          <SheetDescription className="text-xs">
            המחירים מנורמלים לדולר ולאותו תוכן (לילות, מזוודה, כוכבים). הפער = שלנו פחות שלהם.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {data?.ours_at
              ? `הפירוט שלנו נכון ל-${data.ours_at.slice(0, 10)} (הטיסה והמלון שהכלל בוחר)`
              : "הפירוט שלנו טרם נשלף - מוצג הכלל"}
          </span>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
            {refreshing ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="me-1 h-3.5 w-3.5" />}
            פרט את שלנו עכשיו
          </Button>
        </div>
        {data && data.ours_errors.length > 0 && (
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{data.ours_errors.join(" · ")}</div>
        )}

        {loading && !data && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען…
          </div>
        )}
        {!loading && data == null && <div className="py-8 text-sm text-muted-foreground">לא נמצא מידע לאירוע.</div>}

        {data && scopes.map((scope) => (
          <section key={scope} className="mt-5 space-y-2">
            <h3 className="text-sm font-semibold">{SCOPE_HE[scope]}</h3>
            {data[scope].map((offer) => (
              <OfferCard key={`${scope}:${offer.who}`} offer={offer} scope={scope} />
            ))}
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}
