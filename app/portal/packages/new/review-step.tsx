"use client";

/**
 * Summary step - myt-main's OrderReview/OrderSummary, agent-side. V2
 * (2026-08-27): the link auto-builds on entry (no "יצירת לינק" button), the
 * open/locked toggle sits at the top next to the event name, the commission
 * row carries a "הוסף עמלה / תן הנחה ללקוח" control, and the CTAs are
 * הזמן (handoff to main's agent screen) + שלח הצעה (copy link / PDF quote).
 */

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  BedDouble,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Plane,
  Plus,
  SlidersHorizontal,
  Ticket,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { createQuote } from "@/lib/actions/quote-actions";
import { cn } from "@/lib/utils";
import { useWizard } from "./wizard-context";
import {
  BuildProgressBar,
  dateFmt,
  dateOnly,
  deltaNote,
  usd,
  type Delta,
} from "./wizard-ui";

const round2 = (n: number) => Math.round(n * 100) / 100;

const EDIT_CHIP =
  "shrink-0 rounded-lg border border-border px-2.5 py-1 text-[12px] font-bold text-muted-foreground transition-colors hover:border-brand-forest hover:text-brand-forest dark:hover:border-brand-mint dark:hover:text-brand-mint";

function SectionRow({
  icon: Icon,
  primary,
  secondary,
  body,
  amount,
  editStep,
  onEdit,
  addMode,
}: {
  icon: LucideIcon;
  primary: string;
  secondary: string | null;
  body?: React.ReactNode;
  amount?: string | null;
  editStep: number;
  onEdit: (step: number) => void;
  /** Dashed "not pinned" style with the + chip (main's + להוספה rows). */
  addMode?: boolean;
}) {
  if (addMode) {
    return (
      <button
        type="button"
        onClick={() => onEdit(editStep)}
        className="flex w-full items-center justify-between rounded-xl border border-dashed border-border px-3 py-2.5 text-right transition-colors hover:border-brand-forest hover:bg-brand-forest/5 dark:hover:border-brand-mint dark:hover:bg-brand-mint/10"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="text-[16px] text-brand-forest dark:text-brand-mint">
            <Icon size={18} />
          </span>
          <span className="min-w-0 text-right">
            <span className="block truncate text-[14px] font-semibold text-muted-foreground">
              {primary}
            </span>
            {secondary && (
              <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
            )}
          </span>
        </span>
        <span className="shrink-0 rounded-lg border border-brand-forest px-2.5 py-1 text-[12px] font-bold text-brand-forest dark:border-brand-mint dark:text-brand-mint">
          + להוספה
        </span>
      </button>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`עריכת ${primary}`}
        onClick={() => onEdit(editStep)}
        className={cn("absolute left-0 top-0", EDIT_CHIP)}
      >
        עריכה
      </button>
      <div className="flex items-start gap-3 pe-0 ps-0">
        <span className="mt-0.5 shrink-0 text-[18px] text-brand-forest dark:text-brand-mint">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-bold leading-[20px] text-brand-forest dark:text-foreground">
            {primary}
            {amount && (
              <span className="mr-2 text-[14px] font-semibold text-muted-foreground" dir="ltr">
                {amount}
              </span>
            )}
          </p>
          {secondary && <p className="mt-0.5 text-[14px] text-muted-foreground">{secondary}</p>}
          {body && <div className="mt-1 space-y-1 text-[14px]">{body}</div>}
        </div>
      </div>
    </div>
  );
}

const amountOf = (delta: Delta | null): string | null => {
  if (!delta) return null;
  if (delta.kind === "included") return "(כלול במחיר)";
  return `(${deltaNote(delta)} לנוסע)`;
};

export function ReviewStep({ editStep }: { editStep: (target: number) => void }) {
  const w = useWizard();
  const [building, setBuilding] = useState(false);
  const [buildDone, setBuildDone] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);

  useEffect(() => {
    if (!w.isPending) {
      setBuilding(false);
      setBuildDone(false);
      return;
    }
    setBuilding(true);
    const t = window.setTimeout(() => setBuildDone(true), 1700);
    return () => window.clearTimeout(t);
  }, [w.isPending]);

  const { event, selectedTicket } = w;
  if (!event || !selectedTicket) return null;

  // Adjusted per-person price: the site price for this composition plus the
  // agent's uplift/discount. The adjustment reaches the customer through the
  // quote link/PDF; the plain package link keeps pricing live.
  const adjustedPerPerson =
    w.totalPerPerson != null ? round2(w.totalPerPerson + w.adjustPerPerson) : null;
  const totalPkg = adjustedPerPerson != null ? adjustedPerPerson * w.qty : null;
  const baseTotalPkg = w.totalPerPerson != null ? w.totalPerPerson * w.qty : null;
  const baseCommission = (() => {
    const terms = w.commissionTerms;
    if (!terms || terms.rate == null || !Number.isFinite(terms.rate) || terms.rate <= 0) return null;
    if (terms.type === "percent_of_sale") {
      return baseTotalPkg != null ? (baseTotalPkg * terms.rate) / 100 : null;
    }
    return w.qty * terms.rate; // fixed_per_ticket - the legacy default
  })();
  // Preview only - the server re-derives and enforces the real rule at quote
  // creation (discount may never exceed the commission).
  const commission =
    baseCommission != null
      ? Math.max(0, round2(baseCommission + w.adjustPerPerson * w.qty))
      : w.adjustPerPerson > 0
        ? round2(w.adjustPerPerson * w.qty)
        : null;
  const maxDiscountPerPerson = (() => {
    const terms = w.commissionTerms;
    if (!terms || terms.rate == null || terms.rate <= 0) return 0;
    if (terms.type === "percent_of_sale") {
      return w.totalPerPerson != null
        ? round2((w.totalPerPerson * terms.rate) / 100)
        : 0;
    }
    return round2(terms.rate);
  })();

  /* flight section content */
  const flightSecondary = (() => {
    if (w.flightChoice.mode === "offline") {
      const f = w.flights.find((x) => x.id === (w.flightChoice as { flightId: number }).flightId);
      return f ? f.airline_name : null;
    }
    if (w.flightChoice.mode === "live-offer") {
      const offer = w.flightChoice.offer;
      return offer.metadata?.name || offer.airline;
    }
    return null;
  })();
  const flightDates = (() => {
    if (w.flightChoice.mode === "offline") {
      const f = w.flights.find((x) => x.id === (w.flightChoice as { flightId: number }).flightId);
      return f
        ? `מ-${dateFmt(f.outbound_departure_time)} עד-${dateFmt(f.inbound_departure_time)}`
        : null;
    }
    if (w.flightChoice.mode === "live-offer") {
      const offer = w.flightChoice.offer;
      return `מ-${dateFmt(offer.outbound.departureTime)} עד-${dateFmt(offer.inbound.departureTime)}`;
    }
    return null;
  })();

  /* hotel section content */
  const hotelSecondary = (() => {
    if (w.hotelChoice.mode === "offline") {
      const names = [
        ...new Set(
          w.hotels
            .filter((h) => (w.selectedUnits[h.rowId] ?? 0) > 0)
            .map((h) => h.hotel_name),
        ),
      ];
      return names.join(", ") || null;
    }
    if (w.hotelChoice.mode === "live-offer") return w.hotelChoice.option.name;
    return null;
  })();
  const hotelBody = (() => {
    if (w.hotelChoice.mode === "offline") {
      const rooms = w.hotels.filter((h) => (w.selectedUnits[h.rowId] ?? 0) > 0);
      if (rooms.length === 0) return null;
      return (
        <>
          {rooms.map((room) => (
            <p key={room.rowId}>
              {w.selectedUnits[room.rowId]} × <span dir="ltr">{room.room_type}</span>
            </p>
          ))}
          <p className="text-muted-foreground" dir="ltr">
            {rooms[0].check_in} → {rooms[0].check_out}
          </p>
        </>
      );
    }
    if (w.hotelChoice.mode === "live-offer") {
      // The option's own stay window - the search inputs may have been edited
      // since this option was picked, but the snapshot keeps what was priced.
      const option = w.hotelChoice.option;
      return (
        <p>
          <span className="font-bold" dir="ltr">
            {option.room_name}
          </span>
          {option.checkin && option.checkout && (
            <span className="ms-2 text-muted-foreground" dir="ltr">
              {dateOnly(option.checkin)} → {dateOnly(option.checkout)}
            </span>
          )}
        </p>
      );
    }
    return null;
  })();

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {/* Dark title band */}
        <div
          dir="rtl"
          className="flex flex-row items-center justify-between bg-brand-forest px-6 py-4 text-white"
        >
          <div className="flex items-center gap-3">
            {event.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.image_url}
                alt=""
                className="size-12 shrink-0 rounded-full border-2 border-white object-cover object-top shadow-md md:size-14"
              />
            )}
            <h2 className="text-2xl font-bold">סיכום החבילה</h2>
          </div>
          <div className="text-left text-sm">
            <p className="font-semibold">{w.qty} נוסעים</p>
            <p className="text-white/80">{dateFmt(event.date)}</p>
          </div>
        </div>

        {/* Grand total + עמלה/הנחה control (V2) */}
        {adjustedPerPerson != null && (
          <div dir="rtl" className="border-b border-border px-6 py-4">
            <div className="flex flex-row items-center justify-between">
              <div className="flex flex-col items-start font-bold">
                <span className="text-[22px]">סה&quot;כ</span>
                {commission != null && commission > 0 && (
                  <span className="text-[14px] text-success tabular-nums">
                    עמלה צפויה {usd(commission)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setAdjustOpen((v) => !v)}
                  className="mt-1 flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] font-bold text-muted-foreground transition-colors hover:border-brand-forest hover:text-brand-forest dark:hover:border-brand-mint dark:hover:text-brand-mint"
                >
                  <SlidersHorizontal className="size-3.5" />
                  הוסף עמלה / תן הנחה ללקוח
                </button>
              </div>
              <div className="text-left">
                <div className="flex w-full items-baseline justify-end gap-2 text-[18px] font-bold" dir="ltr">
                  <span className="text-xl tabular-nums">{totalPkg != null ? usd(totalPkg) : ""}</span>
                </div>
                <div className="flex w-full items-center justify-end gap-1 text-lg font-semibold text-muted-foreground">
                  <span>
                    (לאדם{" "}
                    <span className="tabular-nums" dir="ltr">
                      {usd(adjustedPerPerson)}
                    </span>
                    )
                  </span>
                </div>
                {w.adjustPerPerson !== 0 && w.totalPerPerson != null && (
                  <p className="mt-0.5 text-end text-xs text-muted-foreground">
                    מחיר האתר: <span dir="ltr" className="tabular-nums">{usd(w.totalPerPerson)}</span> לנוסע
                  </p>
                )}
              </div>
            </div>
            {adjustOpen && (
              <div className="mt-3 rounded-xl border border-dashed border-border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="pkg-adjust" className="text-sm font-medium">
                    שינוי מחיר לנוסע ($)
                  </label>
                  <Input
                    id="pkg-adjust"
                    type="number"
                    dir="ltr"
                    step={5}
                    value={w.adjustPerPerson || ""}
                    placeholder="0"
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      if (!Number.isFinite(raw)) {
                        w.setAdjustPerPerson(0);
                        return;
                      }
                      // Discount is capped by the commission; uplift is free.
                      w.setAdjustPerPerson(
                        round2(Math.max(-maxDiscountPerPerson, raw)),
                      );
                    }}
                    className="h-9 w-28 text-center"
                  />
                  {w.adjustPerPerson !== 0 && (
                    <button
                      type="button"
                      onClick={() => w.setAdjustPerPerson(0)}
                      className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
                    >
                      איפוס
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  חיובי = תוספת עמלה שלכם מעל מחיר האתר. שלילי = הנחה ללקוח על
                  חשבון העמלה (עד {usd(maxDiscountPerPerson)} לנוסע). המחיר
                  נשמר על החבילה עצמה - כל מי שיפתח את הלינק יראה אותו, וגם
                  ההצעה וה-PDF יוצאים לפיו.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Sections - ticket → hotel → flight, like main */}
        <div dir="rtl" className="space-y-3 px-6 py-4 text-right">
          <div className="text-center">
            <p className="text-2xl font-bold leading-tight">{event.name}</p>
            <p className="text-lg text-muted-foreground">
              {[event.location_name, dateFmt(event.date)].filter(Boolean).join(" | ")}
            </p>
            {/* V2: the open/locked choice lives HERE, next to the event name,
                as a compact segmented toggle (was a radio-card block at the
                bottom). Changing it re-syncs the package automatically. */}
            <div
              role="radiogroup"
              aria-label="לינק פתוח לעריכה או נעול"
              className="mx-auto mt-2 inline-flex items-center rounded-full border border-border p-0.5"
            >
              {[
                { value: true, icon: Pencil, title: "פתוחה לעריכה" },
                { value: false, icon: Lock, title: "נעולה" },
              ].map((opt) => {
                const selected = w.allowEdit === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.title}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => w.setAllowEdit(opt.value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors",
                      selected
                        ? "bg-brand-forest text-white dark:bg-brand-mint dark:text-brand-forest"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {opt.title}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {w.allowEdit
                ? "הלקוח יוכל להחליף כרטיסים, טיסה ומלון לפני התשלום."
                : "הלקוח משלם על ההרכב שבניתם - רכיב שנשאר לבחירה חיה עדיין ייבחר על ידו."}
            </p>
          </div>
          <div className="w-full border-b border-border" />

          <SectionRow
            icon={Ticket}
            primary={`כרטיסים (${w.qty})`}
            secondary={`קטגוריה: ${selectedTicket.category}`}
            amount={amountOf(w.ticketDelta)}
            editStep={1}
            onEdit={editStep}
          />

          {w.hotelChoice.mode === "offline" || w.hotelChoice.mode === "live-offer" ? (
            <SectionRow
              icon={BedDouble}
              primary={`לינה (${w.qty} אורחים)`}
              secondary={hotelSecondary}
              body={hotelBody}
              amount={amountOf(w.hotelDelta)}
              editStep={3}
              onEdit={editStep}
            />
          ) : (
            <SectionRow
              icon={BedDouble}
              primary={
                w.hotelChoice.mode === "none"
                  ? "חבילה ללא מלון"
                  : "מלון - הלקוח יבחר באתר"
              }
              secondary={
                w.hotelChoice.mode === "none"
                  ? "הלקוח מסדר לינה לבד"
                  : "הלינק יפתח את שלב המלונות עם ההיצע החי"
              }
              editStep={3}
              onEdit={editStep}
              addMode
            />
          )}

          {w.flightChoice.mode === "offline" || w.flightChoice.mode === "live-offer" ? (
            <SectionRow
              icon={Plane}
              primary={`טיסה (${w.qty} נוסעים)`}
              secondary={flightSecondary}
              body={flightDates ? <p className="text-muted-foreground">{flightDates}</p> : null}
              amount={amountOf(w.flightDelta)}
              editStep={2}
              onEdit={editStep}
            />
          ) : (
            <SectionRow
              icon={Plane}
              primary={
                w.flightChoice.mode === "none"
                  ? "חבילה ללא טיסה"
                  : "טיסה - הלקוח יבחר באתר"
              }
              secondary={
                w.flightChoice.mode === "none"
                  ? "הלקוח מגיע בכוחות עצמו"
                  : "הלינק יפתח את שלב הטיסות עם הזמינות בזמן אמת"
              }
              editStep={2}
              onEdit={editStep}
              addMode
            />
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        המחיר המשוער הוא מחיר החבילה באתר לקטגוריה שנבחרה, בתוספת ההפרשים של טיסה או
        מלון ספציפיים שהוצמדו. הכל מאומת מחדש מול נתונים חיים בכל פתיחה של הלינק.
      </p>

      {w.submitError && (
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-destructive">{w.submitError}</p>
          <button
            type="button"
            onClick={w.submit}
            className="text-sm font-bold text-brand-forest underline dark:text-brand-mint"
          >
            נסו שוב
          </button>
        </div>
      )}

      {/* V2: the link builds itself (main's build animation while pending),
          then the ready link + the two CTAs. */}
      {building || (w.link == null && !w.submitError) ? (
        <div className="flex flex-col gap-1.5">
          <BuildProgressBar />
          <span className="text-center text-[13px] font-extrabold text-brand-forest dark:text-brand-mint">
            {buildDone ? "✓ החבילה כמעט מוכנה!" : "מרכיבים את החבילה…"}
          </span>
        </div>
      ) : w.link != null ? (
        <div className="animate-in fade-in zoom-in-95 duration-300 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0 text-brand-forest dark:text-brand-mint" />
            <p className="text-sm font-bold">הלינק לחבילה מוכן</p>
            {w.isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              dir="ltr"
              value={w.link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => w.copyLink()}
              className="shrink-0"
            >
              {w.copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {w.copied ? "הועתק" : "העתקה"}
            </Button>
          </div>
          {w.isAgent ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                onClick={w.orderForCustomer}
                disabled={w.handoffPending || w.createdId == null}
                className="h-[48px] bg-brand-forest text-[16px] font-bold text-white hover:bg-brand-forest/90 dark:bg-brand-mint dark:text-brand-forest dark:hover:bg-brand-mint/90"
              >
                {w.handoffPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                הזמן
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOfferOpen(true)}
                disabled={w.createdId == null || adjustedPerPerson == null}
                className="h-[48px] text-[16px] font-bold"
              >
                <FileText className="size-4" />
                שלח הצעה
              </Button>
            </div>
          ) : null}
          <div className="flex justify-center gap-4 text-sm">
            <Link href="/portal/packages" className="text-muted-foreground underline hover:text-foreground">
              לרשימת החבילות
            </Link>
            <button
              type="button"
              onClick={w.resetWizard}
              className="text-muted-foreground underline hover:text-foreground"
            >
              בניית חבילה נוספת
            </button>
          </div>
        </div>
      ) : null}

      {w.isAgent && adjustedPerPerson != null && (
        <SendOfferDialog
          open={offerOpen}
          onOpenChange={setOfferOpen}
          adjustedPerPerson={adjustedPerPerson}
        />
      )}
    </section>
  );
}

/**
 * "שלח הצעה" (V2): copy the link (signed with the adjusted price when one was
 * set) or fill a short form and get a customer-ready PDF. Both paths create a
 * quotes row, so the offer shows up in הצעות מחיר for follow-up.
 */
function SendOfferDialog({
  open,
  onOpenChange,
  adjustedPerPerson,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjustedPerPerson: number;
}) {
  const w = useWizard();
  const [mode, setMode] = useState<"choice" | "pdf">("choice");
  const [customerName, setCustomerName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [includeLink, setIncludeLink] = useState(true);
  const [extras, setExtras] = useState<{ label: string; qty: string; price: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const { event } = w;
  if (!event) return null;

  const pkgLine = {
    label: `חבילת ${event.name}${w.category ? ` - ${w.category}` : ""}`,
    qty: w.qty,
    unit_price: adjustedPerPerson,
    // The package itself is fulfilled by us; extra rows the agent types below
    // are marked "agent" - the server stamps the per-line "יבוצע ע"י" name.
    source: "site" as const,
  };

  const reset = () => {
    setMode("choice");
    setError(null);
    setDoneMsg(null);
  };

  const quoteInputBase = {
    event_id: event.id,
    title: `הצעת מחיר - ${event.name}`,
    package: { qty: w.qty, unit_price: adjustedPerPerson },
    package_id: w.createdId,
  };

  // "שלח לינק": ONE link, always. Since 2026-08-30 the price change lives on
  // the package row itself (doc item 4 - "שמשנים עמלה זה צריך להשפיע על
  // הלינק"), so the plain link already quotes it; no shadow quote row is
  // created behind the agent's back any more.
  const sendLink = () => {
    if (!w.link) return;
    setError(null);
    w.copyLink();
    setDoneMsg(
      w.adjustPerPerson === 0
        ? "הלינק הועתק - שלחו אותו ללקוח."
        : "הלינק הועתק - הוא נושא את המחיר שקבעתם.",
    );
  };

  const submitPdf = () => {
    if (!w.link) return;
    if (!customerName.trim()) {
      setError("שם הלקוח חובה");
      return;
    }
    setError(null);
    const extraLines = extras
      .filter((r) => r.label.trim())
      .map((r) => ({
        label: r.label.trim(),
        qty: Math.max(1, Math.floor(Number(r.qty) || 1)),
        unit_price: Math.max(0, Number(r.price) || 0),
        source: "agent" as const,
      }));
    // Popup-blocker-safe: open the tab in the click, fill it once the PDF is
    // ready (same pattern as the quotes list).
    const win = window.open("", "_blank");
    startTransition(async () => {
      const res = await createQuote({
        ...quoteInputBase,
        customer_name: customerName.trim(),
        line_items: [pkgLine, ...extraLines],
        notes: notes.trim() || null,
        valid_until: validUntil || null,
        payment_link: includeLink ? w.link : null,
      });
      if (!res.ok) {
        win?.close();
        setError(res.error);
        return;
      }
      const fallbackMsg =
        "ההצעה נוצרה ונשמרה בהצעות מחיר, אבל יצירת ה-PDF נכשלה - אפשר להוריד אותה משם.";
      try {
        const pdfRes = await fetch(`/portal/api/quotes/${res.id}/pdf`, { method: "POST" });
        const data = await pdfRes.json().catch(() => null);
        if (pdfRes.ok && data?.ok && data.url) {
          if (win) win.location.href = data.url;
          else window.open(data.url, "_blank");
          setDoneMsg("ה-PDF מוכן ונפתח - ההצעה נוספה למעקב בהצעות מחיר.");
        } else {
          win?.close();
          setDoneMsg(fallbackMsg);
        }
      } catch {
        win?.close();
        setDoneMsg(fallbackMsg);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-right">שלח הצעה ללקוח</DialogTitle>
        </DialogHeader>

        {doneMsg ? (
          <div className="animate-in fade-in duration-300 space-y-4">
            <p className="text-sm font-medium text-success">{doneMsg}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                סגירה
              </Button>
              <Button asChild variant="outline">
                <Link href="/portal/quotes">להצעות מחיר</Link>
              </Button>
            </div>
          </div>
        ) : mode === "choice" ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={sendLink}
              disabled={pending}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-border p-3 text-right transition-colors hover:border-brand-forest dark:hover:border-brand-mint"
            >
              {pending ? (
                <Loader2 className="size-5 shrink-0 animate-spin" />
              ) : (
                <Link2 className="size-5 shrink-0 text-brand-forest dark:text-brand-mint" />
              )}
              <span>
                <span className="block font-bold">שלח לינק</span>
                <span className="block text-xs text-muted-foreground">
                  מעתיק את הלינק - הלקוח נכנס, רואה את החבילה ומשלים פרטים ותשלום.
                  {w.adjustPerPerson !== 0 && " הלינק ישא את המחיר שקבעתם."}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("pdf")}
              disabled={pending}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-border p-3 text-right transition-colors hover:border-brand-forest dark:hover:border-brand-mint"
            >
              <FileText className="size-5 shrink-0 text-brand-forest dark:text-brand-mint" />
              <span>
                <span className="block font-bold">שלח PDF</span>
                <span className="block text-xs text-muted-foreground">
                  הצעת מחיר מעוצבת עם שם הלקוח, תוקף והערות - מוכנה לשליחה.
                </span>
              </span>
            </button>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="offer-customer" className="mb-1 block text-sm font-medium">
                  שם הלקוח *
                </label>
                <Input
                  id="offer-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="ישראל ישראלי"
                />
              </div>
              <div>
                <label htmlFor="offer-valid" className="mb-1 block text-sm font-medium">
                  בתוקף עד
                </label>
                <Input
                  id="offer-valid"
                  type="date"
                  dir="ltr"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="offer-notes" className="mb-1 block text-sm font-medium">
                הערות
              </label>
              <Textarea
                id="offer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="הערות שיופיעו בהצעה..."
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={includeLink}
                onCheckedChange={(v) => setIncludeLink(v === true)}
              />
              לינק להרשמה ותשלום ב-PDF
            </label>

            {/* Extra rows on top of the package line */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">שורות נוספות</p>
                <button
                  type="button"
                  onClick={() => setExtras((r) => [...r, { label: "", qty: "1", price: "0" }])}
                  className="flex items-center gap-1 text-xs font-bold text-brand-forest dark:text-brand-mint"
                >
                  <Plus className="size-3.5" /> הוספת שורה
                </button>
              </div>
              <p className="text-xs text-muted-foreground" dir="ltr">
                {pkgLine.qty} × {usd(pkgLine.unit_price)} - {pkgLine.label}
              </p>
              {extras.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.label}
                    onChange={(e) =>
                      setExtras((r) => r.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="תיאור"
                    className="flex-1"
                  />
                  <Input
                    value={row.qty}
                    onChange={(e) =>
                      setExtras((r) => r.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                    }
                    type="number"
                    dir="ltr"
                    className="w-16 text-center"
                    aria-label="כמות"
                  />
                  <Input
                    value={row.price}
                    onChange={(e) =>
                      setExtras((r) => r.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                    }
                    type="number"
                    dir="ltr"
                    className="w-24 text-center"
                    aria-label="מחיר ליחידה ($)"
                  />
                  <button
                    type="button"
                    onClick={() => setExtras((r) => r.filter((_, j) => j !== i))}
                    aria-label="מחיקת שורה"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setMode("choice")}>
                חזרה
              </Button>
              <Button type="button" onClick={submitPdf} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                צור PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
