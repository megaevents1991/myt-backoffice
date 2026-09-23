"use client";

// One table per scope for ONE event (2026-09-17): suppliers down (us first), flight / hotel / ticket
// across, so our flight sits right above theirs. Contents are worded in the
// partner's format (2026-09-14): "טיסות: אל על עם מזוודה ישיר 16-20 | מלון: שם מלון כולל ארוחת בוקר או
// ללא | סוג כרטיס". Loaded on demand - detail pages are long, the list never carries them.
import { Fragment, useCallback, useEffect, useState } from "react";
import { BedDouble, Brain, ExternalLink, Hand, Lightbulb, Loader2, Pencil, Plane, RefreshCw, Ticket } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { getPriceLightComparison, refreshOurOffer, setCompetitorLightOverride } from "@/lib/actions/price-light-actions";
import { addAgentInstruction } from "@/lib/actions/ai-factory-actions";
import { signedUsd } from "@/lib/services/price-light";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "@/lib/services/price-margins";
import { COMPETITOR_LABEL, PILL } from "@/app/(dashboard)/events/price-light-ui";
import type { CorrectionField } from "@/lib/services/price-light-corrections";
import type { CompetitorKey, ComparisonOffer, PriceLightComparison, PriceLightRow, Scope } from "@/types/price-light.types";
import { CorrectionDialog, correctionValueText, FIELD_HE } from "./correction-dialog";

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
function Part({ text, note = null }: { text: string | null; note?: string | null }) {
  return (
    <td className={cn("border-s px-3 py-2 align-top leading-relaxed", !text && "text-muted-foreground")}>
      {text ? <Mixed text={text} /> : "לא פורסם"}
      {note && <div className="mt-1 text-muted-foreground"><Mixed text={note} /></div>}
    </td>
  );
}

// The like-for-like steps that move OUR package onto theirs, in the reader's words (shown with the
// sign flipped: a step that would lower THEIR price raises ours by the same amount).
const ADJUSTMENT_HE: Record<string, string> = {
  bag: "מזוודה כמו אצלם", connection: "הם בקונקשן", stars: "כוכבי מלון כמו אצלם", nights: "לילות כמו אצלם", breakfast: "ארוחת בוקר כמו אצלם", transfers: "העברות כמו אצלם",
  low_cost: "הפרש לואו-קוסט",
};

const FORCE_LIGHTS = [
  { light: "green", label: "ירוק", cls: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { light: "orange", label: "כתום", cls: "bg-amber-500 hover:bg-amber-600 text-white" },
  { light: "red", label: "אדום", cls: "bg-red-600 hover:bg-red-700 text-white" },
] as const;
const LIGHT_HE: Record<string, string> = { green: "ירוק", orange: "כתום", red: "אדום" };

type Changed = (comparison: PriceLightComparison | null, row: PriceLightRow | null) => void;

/**
 * "סמן מול <מתחרה>" (staff note 23.09): after reading the comparison, decide the verdict against
 * THIS competitor yourself - "they fly low-cost, we fly El Al, the gap keeps us green". The other
 * competitors keep counting; the call lapses once this competitor's price moves more than $20.
 */
function CompetitorVerdict({ eventId, scope, offer, onChanged }: { eventId: number; scope: Scope; offer: ComparisonOffer; onChanged: Changed }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const name = COMPETITOR_LABEL[offer.who as CompetitorKey] ?? offer.who;

  const save = async (light: "green" | "orange" | "red" | null) => {
    setBusy(true);
    try {
      const res = await setCompetitorLightOverride({ eventId, scope, competitor: offer.who as CompetitorKey, light, note });
      if (!res.ok) { toast({ variant: "destructive", title: "לא נשמר", description: res.error }); return; }
      toast({ title: light ? `סומן ${LIGHT_HE[light]} מול ${name} - הרמזור חושב מחדש` : `הסימון מול ${name} בוטל` });
      onChanged(res.comparison, res.row);
      setOpen(false);
      setNote("");
    } catch (e) {
      console.error("setCompetitorLightOverride failed", e);
      toast({ variant: "destructive", title: "לא נשמר", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  if (offer.forced) {
    return (
      <div className="mt-1 space-y-0.5">
        <div
          className="inline-block rounded bg-violet-100 px-1 py-0.5 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200"
          title={`${offer.forced.note} · ${offer.forced.by} · ${offer.forced.at.slice(0, 10)}`}
        >
          ✋ סומן ידנית{offer.forced.computed ? ` (מחושב: ${LIGHT_HE[offer.forced.computed] ?? offer.forced.computed})` : ""}
        </div>
        <div dir="auto" className="line-clamp-2 text-muted-foreground" title={offer.forced.note}>{offer.forced.note}</div>
        <button type="button" disabled={busy} onClick={() => save(null)} className="text-muted-foreground underline hover:text-foreground">
          {busy ? "…" : "בטל סימון"}
        </button>
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="mt-1 flex items-center gap-1 text-muted-foreground hover:text-foreground" title="אחרי שבדקת את ההשוואה - קבע בעצמך את הצבע מול המתחרה הזה">
          <Hand className="h-3 w-3" aria-hidden /> סמן צבע מול {name}
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" className="w-72 space-y-2 text-xs">
        <div className="font-medium">הצבע מול {name}</div>
        <p className="text-muted-foreground">
          שאר המתחרים ממשיכים להיספר, והרמזור לוקח את הגרוע מביניהם. הסימון פג לבד אם המחיר של {name} זז ביותר מ-$20.
        </p>
        <Textarea dir="auto" rows={2} maxLength={300} placeholder="למה? (חובה) - למשל: הם לואו קוסט ואנחנו אל על" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-1.5">
          {FORCE_LIGHTS.map((f) => (
            <Button key={f.light} size="sm" className={cn("flex-1", f.cls)} disabled={busy || note.trim().length < 3} onClick={() => save(f.light)}>
              {f.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "הוסף חוק ל-AI" (staff note 23.09): a standing instruction for the price-light agent, written
 * where the reader just saw it get something wrong. Same `agent_instructions` rows as AI Factory's
 * "זיכרון ולימוד" tab, where they are listed and retired. The agent matches events and reads what a
 * listing contains - it never sets a color or a price, and the dialog says so.
 */
function TeachAiDialog({ eventName }: { eventName: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const res = await addAgentInstruction("price-light", text);
      if (!res.ok) {
        toast({ variant: "destructive", title: "החוק לא נשמר", description: res.kind === "invalid_text" ? "בין 3 ל-500 תווים" : res.kind });
        return;
      }
      toast({ title: "החוק נוסף ל-AI", description: "ייכנס לכל קריאה הבאה. לרשימה ולביטול: AI Factory ← זיכרון ולימוד" });
      setText("");
      setOpen(false);
    } catch (e) {
      console.error("addAgentInstruction failed", e);
      toast({ variant: "destructive", title: "החוק לא נשמר", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Brain className="me-1 h-3.5 w-3.5" /> הוסף חוק ל-AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle>חוק חדש ל-AI של הרמזור</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              ה-AI מחליט <b>איזו מודעה היא אותו אירוע</b> ו<b>קורא מה יש בחבילה</b> (לילות, כוכבים, מזוודה, טיסה ישירה,
              ארוחת בוקר, העברות). הוא לא קובע צבע ולא מחיר - לזה יש את &quot;סמן צבע מול מתחרה&quot; בטבלה.
              דוגמה טובה: &quot;תיק גב בלבד במודעה = בלי מזוודה&quot;. נכתב מתוך: {eventName}.
            </DialogDescription>
          </DialogHeader>
          <Textarea dir="auto" rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="החוק, במשפט אחד או שניים" />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button onClick={save} disabled={busy || text.trim().length < 3}>
              {busy && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />} שמור חוק
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OfferRow({ offer, scope, onEdit, eventId, onChanged, ourUsd }: {
  offer: ComparisonOffer; scope: Scope; onEdit: () => void; eventId: number; onChanged: Changed;
  /** Our price for this scope - a competitor row shows it adjusted onto their package. */
  ourUsd: number | null;
}) {
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
          {/* Staff fix what the crawl got wrong - never our own side, that is the pricing rule's. */}
          {!ours && (offer.edit || offer.corrections.length > 0) && (
            <button type="button" onClick={onEdit} title="תיקון הערכים של המודעה (עם הערה ל-AI)" className="ms-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Pencil className="h-3 w-3" aria-hidden />
              <span className="sr-only">תיקון</span>
            </button>
          )}
        </div>
        {offer.corrections.length > 0 && (
          <button
            type="button"
            onClick={onEdit}
            title={offer.corrections.map((c) => `${FIELD_HE[c.field as CorrectionField] ?? c.field}: ${correctionValueText(c.original)} ← ${correctionValueText(c.value)} · ${c.note}`).join("\n")}
            className="mt-1 inline-block rounded bg-sky-100 px-1 py-0.5 text-sky-900 hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-200"
          >
            ✎ תוקן ידנית · {offer.corrections.map((c) => FIELD_HE[c.field as CorrectionField] ?? c.field).join(", ")}
          </button>
        )}
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
          <Part text={offer.lines.ticket} note={offer.ticket_note} />
        </>
      )}

      <td className="w-36 border-s px-3 py-2 align-top tabular-nums">
        {/* Their price stays what they PUBLISHED; the like-for-like steps move OUR package onto
            theirs instead (Alon, QA 23.09: "לא רוצה שיוריד את המחיר מהם אלא שיתאים את החבילה שלנו
            לחבילה שלהם"). Same arithmetic, same gap and light: ours − Σadj vs theirs. */}
        {ours && offer.normalized_usd != null && <div className="text-sm font-semibold">${offer.normalized_usd.toLocaleString("en-US")}</div>}
        {!ours && (offer.usd ?? offer.normalized_usd) != null && (
          <div className="text-sm font-semibold">${Math.round((offer.usd ?? offer.normalized_usd) as number).toLocaleString("en-US")}</div>
        )}
        {published && offer.raw_currency !== "USD" && <div className="text-muted-foreground">({published})</div>}
        {!ours && offer.adjustments.length > 0 && ourUsd != null && (
          <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
            <div>
              שלנו מותאם לחבילה שלהם:{" "}
              <span dir="ltr" className="font-semibold text-foreground">
                ${Math.round(ourUsd - offer.adjustments.reduce((sum, a) => sum + a.usd, 0)).toLocaleString("en-US")}
              </span>
            </div>
            {offer.adjustments.map((a) => (
              <div key={a.key}>{ADJUSTMENT_HE[a.key] ?? a.key} <span dir="ltr">{signedUsd(-a.usd)}</span></div>
            ))}
          </div>
        )}
        {offer.light && offer.diff_usd != null && (
          <span dir="ltr" className={cn("mt-1 inline-block rounded-full px-1.5 py-0.5 font-medium", PILL[offer.light])} title="שלנו, מותאם לחבילה שלהם, פחות המחיר שלהם">
            {signedUsd(offer.diff_usd)}
          </span>
        )}
        {!ours && offer.light && offer.diff_usd != null && (
          <CompetitorVerdict eventId={eventId} scope={scope} offer={offer} onChanged={onChanged} />
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

/**
 * The price advisor's facts for a RED scope (price-advice.ts): a markup cut, a cheaper supplier,
 * a nights gap, other travel days. Facts with their numbers, never a decision - the same lines an
 * auto-opened task carries. Other days / suppliers appear once the 02:40 pass (or "פרט את שלנו
 * עכשיו") has quoted them; until then the block says so rather than look complete.
 */
export function AdviceBlock({ lines, altAt }: { lines: string[]; altAt: string | null }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-xs dark:border-amber-500/30 dark:bg-amber-950/30">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        הצעות לשיפור המחיר (עובדות, לא החלטה)
      </div>
      <ul className="list-disc space-y-1 ps-4 leading-relaxed">
        {lines.map((line) => <li key={line}><bdi>{line}</bdi></li>)}
      </ul>
      <div className="mt-1.5 text-muted-foreground">
        {altAt
          ? `תאריכים וספקים חלופיים נבדקו ב-${altAt.slice(0, 10)}.`
          : "תאריכים וספקים חלופיים עוד לא נבדקו לאירוע הזה - \"פרט את שלנו עכשיו\" בודק אותם מיד."}
      </div>
    </div>
  );
}

/** Suppliers down, components across: our flight above their flight, our hotel above their hotel. */
function OfferTable({ offers, scope, onEdit, eventId, onChanged }: {
  offers: ComparisonOffer[]; scope: Scope; onEdit: (offer: ComparisonOffer) => void; eventId: number; onChanged: Changed;
}) {
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
            <th className={head}>מחיר · פער</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <OfferRow
              key={`${scope}:${offer.who}`} offer={offer} scope={scope} onEdit={() => onEdit(offer)} eventId={eventId} onChanged={onChanged}
              ourUsd={offers.find((o) => o.who === "ours")?.usd ?? null}
            />
          ))}
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
  onRowPatched,
}: {
  eventId: number;
  eventName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A correction moved the lights - the table behind the sheet patches that one row in place. */
  onRowPatched?: (eventId: number, row: PriceLightRow | null) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ scope: Scope; offer: ComparisonOffer } | null>(null);
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
      // Our side moved - the lights were re-derived on the server; the table behind follows.
      if (res.row) onRowPatched?.(eventId, res.row);
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
  const changed: Changed = (comparison, row) => {
    if (comparison) setData(comparison);
    if (row) onRowPatched?.(eventId, row);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The sheet is Hebrew throughout, the dashboard around it is LTR - it sets its own direction. */}
      <SheetContent dir="rtl" className="w-full overflow-y-auto sm:max-w-5xl">
        <SheetHeader className="space-y-1 text-start">
          <SheetTitle>השוואה · {eventName}</SheetTitle>
          <SheetDescription className="text-xs">
            המחיר של כל מתחרה = מה שפרסם, בדולר. את החבילה שלנו מתאימים לתוכן שלהם (לילות, מזוודה, כוכבים, לואו-קוסט). הפער = שלנו המותאם פחות שלהם.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {data?.ours_at
              ? `הפירוט שלנו נכון ל-${data.ours_at.slice(0, 10)} (הטיסה והמלון שהכלל בוחר)`
              : "הפירוט שלנו טרם נשלף - מוצג הכלל"}
          </span>
          <div className="flex gap-2">
            <TeachAiDialog eventName={eventName} />
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
              {refreshing ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="me-1 h-3.5 w-3.5" />}
              פרט את שלנו עכשיו
            </Button>
          </div>
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
            <AdviceBlock lines={data.advice?.[scope] ?? []} altAt={data.alt_at ?? null} />
            <OfferTable offers={data[scope]} scope={scope} onEdit={(offer) => setEditing({ scope, offer })} eventId={eventId} onChanged={changed} />
          </section>
        ))}

        {editing && (
          <CorrectionDialog
            // Remounted per listing, so the form always opens on that listing's own values.
            key={`${editing.scope}:${editing.offer.who}:${editing.offer.edit?.listing_id ?? "none"}`}
            eventId={eventId}
            scope={editing.scope}
            offer={editing.offer}
            open
            onOpenChange={(next) => { if (!next) setEditing(null); }}
            onChanged={changed}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
