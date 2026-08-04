"use client";

/**
 * Summary step — myt-main's OrderReview/OrderSummary, agent-side.
 * Same anatomy: one card with a dark title band, the grand-total row
 * ("סה"כ" + per-person, with the partner's expected commission where main
 * shows it), then a section per component with the exact עריכה chip that
 * jumps back to that step and returns straight here (returnToSummary).
 * Portal-specific tail: the allow-edit switch and the create-link CTA with
 * main's "מרכיבים את החבילה…" build animation.
 */

import { useEffect, useState } from "react";
import { BedDouble, Plane, Ticket, type LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useWizard } from "./wizard-context";
import { dateFmt, dateOnly, deltaNote, usd, type Delta } from "./wizard-ui";

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
          + לקיבוע
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

  const totalPkg = w.totalPerPerson != null ? w.totalPerPerson * w.qty : null;
  const commission = (() => {
    const terms = w.commissionTerms;
    if (!terms || terms.rate == null || !Number.isFinite(terms.rate) || terms.rate <= 0) return null;
    if (terms.type === "percent_of_sale") {
      return totalPkg != null ? (totalPkg * terms.rate) / 100 : null;
    }
    return w.qty * terms.rate; // fixed_per_ticket — the legacy default
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
      const option = w.hotelChoice.option;
      return (
        <p>
          <span className="font-bold" dir="ltr">
            {option.room_name}
          </span>
          {w.hsCheckin && w.hsCheckout && (
            <span className="ms-2 text-muted-foreground" dir="ltr">
              {dateOnly(w.hsCheckin)} → {dateOnly(w.hsCheckout)}
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

        {/* Grand total */}
        {w.totalPerPerson != null && (
          <div dir="rtl" className="flex flex-row items-center justify-between border-b border-border px-6 py-4">
            <div className="flex flex-col items-start font-bold">
              <span className="text-[22px]">סה&quot;כ</span>
              {commission != null && commission > 0 && (
                <span className="text-[14px] text-success tabular-nums">
                  עמלה צפויה {usd(commission)}
                </span>
              )}
            </div>
            <div className="text-left">
              <div className="flex w-full items-baseline justify-end gap-2 text-[18px] font-bold" dir="ltr">
                <span className="text-xl tabular-nums">{totalPkg != null ? usd(totalPkg) : ""}</span>
              </div>
              <div className="flex w-full items-center justify-end gap-1 text-lg font-semibold text-muted-foreground">
                <span>
                  (לאדם{" "}
                  <span className="tabular-nums" dir="ltr">
                    {usd(w.totalPerPerson)}
                  </span>
                  )
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Sections — ticket → hotel → flight, like main */}
        <div dir="rtl" className="space-y-3 px-6 py-4 text-right">
          <div className="text-center">
            <p className="text-2xl font-bold leading-tight">{event.name}</p>
            <p className="text-lg text-muted-foreground">
              {[event.location_name, dateFmt(event.date)].filter(Boolean).join(" | ")}
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
                  : "מלון — הלקוח יבחר באתר"
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
                  : "טיסה — הלקוח יבחר באתר"
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

      {/* Allow-edit switch — portal-specific */}
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div>
          <p className="text-sm font-medium">הלקוח יכול לערוך את החבילה</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {w.allowEdit
              ? "הלקוח יוכל להחליף כרטיסים, טיסה ומלון לפני התשלום."
              : "החבילה נעולה — הלקוח משלם על ההרכב שבניתם. רכיב שהשארתם לבחירה חיה או שהתיישן עדיין ייבחר על ידו."}
          </p>
        </div>
        <Switch checked={w.allowEdit} onCheckedChange={w.setAllowEdit} />
      </div>

      <p className="text-xs text-muted-foreground">
        המחיר המשוער הוא מחיר החבילה באתר לקטגוריה שנבחרה, בתוספת ההפרשים של טיסה או
        מלון ספציפיים שהוצמדו. הכל מאומת מחדש מול נתונים חיים בכל פתיחה של הלינק.
      </p>

      {w.submitError && <p className="text-sm font-medium text-destructive">{w.submitError}</p>}

      {/* Create-link CTA with main's build animation */}
      {building ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full transition-[width] duration-[1800ms] ease-out"
              style={{ width: "100%", background: "hsl(var(--brand-mint))" }}
            />
          </div>
          <span className="text-center text-[13px] font-extrabold text-brand-forest dark:text-brand-mint">
            {buildDone ? "✓ החבילה כמעט מוכנה!" : "מרכיבים את החבילה…"}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={w.submit}
          disabled={w.isPending}
          className="block h-[52px] w-full rounded-lg bg-brand-forest text-[18px] font-bold text-white transition-colors hover:bg-brand-forest/90 disabled:opacity-50 dark:bg-brand-mint dark:text-brand-forest dark:hover:bg-brand-mint/90"
        >
          יצירת לינק לחבילה
        </button>
      )}
    </section>
  );
}
