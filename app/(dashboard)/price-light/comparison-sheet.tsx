"use client";

// One table per scope for ONE event (2026-09-17): suppliers down (us first), flight / hotel / ticket
// across, so our flight sits right above theirs. Contents are worded in the
// partner's format (2026-09-14): "טיסות: אל על עם מזוודה ישיר 16-20 | מלון: שם מלון כולל ארוחת בוקר או
// ללא | סוג כרטיס". Loaded on demand - detail pages are long, the list never carries them.
import { Fragment, useCallback, useEffect, useState } from "react";
import { BedDouble, ExternalLink, Loader2, Plane, RefreshCw, Ticket } from "lucide-react";

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

/** "15:10–17:55" / "12.10–15.10" - a range of times or dates inside a Hebrew line. */
const RANGE = /(\d{1,2}[:.]\d{2})\s*[–-]\s*(\d{1,2}[:.]\d{2})/;

/**
 * One " · " piece of a line, isolated (staff note 17.09, "לסדר את האנגלית עברית"): the lines mix
 * Hebrew with airline codes, Latin hotel names and times, and in one bidi run the pieces traded
 * places ("U8 · 18:25- · חזור 17:55-15:10"). A range is pinned left-to-right with an arrow, so
 * "15:10 → 17:55" can only be read one way.
 */
function Segment({ text }: { text: string }) {
  const m = text.match(RANGE);
  if (!m || m.index == null) return <bdi>{text}</bdi>;
  return (
    <bdi>
      {text.slice(0, m.index)}
      <span dir="ltr" className="inline-block tabular-nums">{m[1]} → {m[2]}</span>
      {text.slice(m.index + m[0].length)}
    </bdi>
  );
}

function Mixed({ text }: { text: string }) {
  return (
    <>
      {text.split(" · ").map((piece, i) => (
        // Pieces of one fixed string - the index is their identity.
        <Fragment key={i}>
          {i > 0 && " · "}
          <Segment text={piece} />
        </Fragment>
      ))}
    </>
  );
}

/** One component of one offer. Ours sits in the row above theirs, so the eye compares down a column. */
function Part({ text }: { text: string | null }) {
  return (
    <td className={cn("border-s px-3 py-2 align-top leading-relaxed", !text && "text-muted-foreground")}>
      {text ? <Mixed text={text} /> : "לא פורסם"}
    </td>
  );
}

function OfferRow({ offer, scope }: { offer: ComparisonOffer; scope: Scope }) {
  const ours = offer.who === "ours";
  const pkg = scope === "package";
  const name = offer.who === "ours" ? "אנחנו" : COMPETITOR_LABEL[offer.who] ?? offer.who;
  const published = !ours ? money(offer.raw, offer.raw_currency) : null;
  const status = statusText(offer);
  const travel = [dayMonth(offer.depart), dayMonth(offer.return)].filter(Boolean).join("–");
  // A competitor with no answer at all has nothing to lay side by side - one muted cell is enough.
  const empty = !ours && !offer.title && offer.normalized_usd == null && !offer.quote_only;

  return (
    <tr className={cn("border-t", ours && "bg-primary/5")}>
      <td className="w-40 px-3 py-2 align-top">
        <div className="flex items-center gap-1.5">
          {offer.decided && <span className="text-muted-foreground" title="קבע את האור">●</span>}
          <span className="text-sm font-semibold">{name}</span>
          {offer.url && (
            <a href={offer.url} target="_blank" rel="noreferrer" title={ours ? "לצפייה באירוע באתר שלנו" : "לצפייה בדף המתחרה"}>
              <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </a>
          )}
        </div>
        {offer.title && !ours && <div dir="auto" className="mt-0.5 line-clamp-2 text-start text-muted-foreground" title={offer.title}>{offer.title}</div>}
        {offer.multi_match && (
          <span className="mt-1 inline-block rounded bg-amber-100 px-1 py-0.5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            חבילה מרובת משחקים
          </span>
        )}
        {pkg && (travel || offer.nights != null) && (
          <div className="mt-1 text-muted-foreground">
            <Mixed text={[offer.nights != null ? `${offer.nights} לילות` : null, travel || null].filter(Boolean).join(" · ")} />
          </div>
        )}
      </td>

      {empty ? (
        <td colSpan={pkg ? 3 : 1} className="border-s px-3 py-2 align-top text-muted-foreground">{status}</td>
      ) : (
        <>
          {pkg && <Part text={offer.lines.flight} />}
          {pkg && <Part text={offer.lines.hotel} />}
          <Part text={offer.lines.ticket} />
        </>
      )}

      <td className="w-36 border-s px-3 py-2 align-top tabular-nums">
        {offer.normalized_usd != null && <div className="text-sm font-semibold">${offer.normalized_usd.toLocaleString("en-US")}</div>}
        {published && offer.raw_currency !== "USD" && <div className="text-muted-foreground">({published})</div>}
        {offer.light && offer.diff_usd != null && (
          <span dir="ltr" className={cn("mt-1 inline-block rounded-full px-1.5 py-0.5 font-medium", PILL[offer.light])} title="המחיר שלנו פחות שלהם, מנורמל">
            {signedUsd(offer.diff_usd)}
          </span>
        )}
        {!empty && status && <div className="text-muted-foreground">{status}</div>}
        {/* Our headline is the margin-free "from" price the light compares; the site price is not. */}
        {ours && offer.site_usd != null && (
          <div className="mt-1 text-muted-foreground">
            באתר ${offer.site_usd.toLocaleString("en-US")} (כולל <span dir="ltr">+${FLIGHT_MARGIN_USD}/+${HOTEL_MARGIN_USD}</span>)
          </div>
        )}
        {ours && pkg && offer.markup_usd != null && (
          <div className="text-muted-foreground">מתוכו מארקאפ ${offer.markup_usd.toLocaleString("en-US")}</div>
        )}
      </td>
    </tr>
  );
}

/** Suppliers down, components across: our flight above their flight, our hotel above their hotel. */
function OfferTable({ offers, scope }: { offers: ComparisonOffer[]; scope: Scope }) {
  const pkg = scope === "package";
  const head = "border-s px-3 py-2 text-start font-medium";
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className={cn("w-full border-collapse text-xs", pkg && "min-w-[760px]")}>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">ספק</th>
            {pkg && <th className={head}><Plane className="me-1 inline h-3.5 w-3.5" aria-hidden />טיסה</th>}
            {pkg && <th className={head}><BedDouble className="me-1 inline h-3.5 w-3.5" aria-hidden />מלון</th>}
            <th className={head}><Ticket className="me-1 inline h-3.5 w-3.5" aria-hidden />כרטיס</th>
            <th className={head}>מחיר מנורמל</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => <OfferRow key={`${scope}:${offer.who}`} offer={offer} scope={scope} />)}
        </tbody>
      </table>
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
      {/* The sheet is Hebrew throughout, the dashboard around it is LTR - it sets its own direction. */}
      <SheetContent dir="rtl" className="w-full overflow-y-auto sm:max-w-5xl">
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
            <OfferTable offers={data[scope]} scope={scope} />
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}
