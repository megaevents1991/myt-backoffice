"use client";

/**
 * The "הזמן כרטיס" dialog of a reservation: the live TixStock listings for this order (its own category first,
 * cheapest first, each with its gap to the ticket cost the order was sold with), the attendees, and the three ticks
 * that must be given before a FINAL purchase. Opened only from the ticket-booking card, which itself renders only
 * for a role the fulfilment tools are open to; every action here answers `hidden` for anyone else.
 * Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.2-7.4.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bookReservationTicket,
  openTicketBooking,
  searchTixstockEvents,
  type OpenTicketBookingResult,
  type TixstockEventHit,
} from "@/lib/actions/ticket-booking-actions";
import type { RankedListing } from "@/lib/tixstock-booking/rank";
import { attendeeIssues, type AttendeeInput } from "@/lib/tixstock-booking/rules";
import { cn } from "@/lib/utils";

type Opened = Extract<OpenTicketBookingResult, { ok: true }>;

const OPEN_ERRORS: Record<string, string> = {
  hidden: "אין הרשאה.",
  not_paid: "אפשר להזמין כרטיס רק להזמנה ששולמה.",
  not_tixstock: "ההזמנה נמכרה מספק אחר - הכרטיסים נקנים אצלו. כאן לא מזמינים לה כרטיסים מ-TixStock.",
  test_without_sandbox: "אירוע בדיקה בלי מצב סנדבוקס - לא מזמינים ממנו כרטיסים.",
  production_closed: "TixStock - הזמנה בפרודקשן עוד לא נפתחה",
  not_configured: "אין חיבור ל-TixStock בסביבה הזו (חסר טוקן).",
  supplier: "TixStock לא ענה כרגע. נסו שוב בעוד רגע.",
  db: "הקריאה נכשלה. נסו שוב.",
};

const BOOK_ERRORS: Record<string, string> = {
  hidden: "אין הרשאה.",
  acks: "יש לסמן את שלושת האישורים.",
  attendees: "פרטי הנוסעים חסרים או לא תואמים את מספר הכרטיסים.",
  shipping: "כרטיס נייר דורש כתובת למשלוח.",
  gap_not_accepted: "הליסטינג יקר מהעלות שנמכרה - יש לאשר את הפער.",
  locked: "להזמנה הזו כבר יש הזמנת כרטיסים פעילה.",
  gone: "הליסטינג כבר לא זמין. בחרו ליסטינג אחר.",
  refused: "TixStock סירב להזמנה.",
  uncertain: "לא ודאי - לא להזמין שוב עד שיתברר",
  production_closed: "TixStock - הזמנה בפרודקשן עוד לא נפתחה",
  not_configured: "אין חיבור ל-TixStock בסביבה הזו (חסר טוקן).",
  db: "ההזמנה נכשלה. בדקו את כרטיס ההזמנה לפני ניסיון נוסף.",
};

const money = (n: number): string => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The attendees of an order, one block each. With `italian`, every attendee carries the identity details. */
export function AttendeesEditor({
  attendees,
  italian,
  onChange,
  disabled = false,
}: {
  attendees: AttendeeInput[];
  italian: boolean;
  onChange: (next: AttendeeInput[]) => void;
  disabled?: boolean;
}) {
  const set = (index: number, patch: Partial<AttendeeInput>) =>
    onChange(attendees.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-3" dir="rtl">
      {attendees.map((a, index) => {
        const issues = attendeeIssues(a, italian);
        return (
          <div key={index} className={cn("rounded-md border p-3", issues.length > 0 && "border-amber-400")}>
            <div className="mb-2 text-sm font-medium">נוסע {index + 1}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`att-first-${index}`}>שם פרטי</Label>
                <Input id={`att-first-${index}`} dir="ltr" disabled={disabled} value={a.first_name} onChange={(e) => set(index, { first_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`att-last-${index}`}>שם משפחה</Label>
                <Input id={`att-last-${index}`} dir="ltr" disabled={disabled} value={a.last_name} onChange={(e) => set(index, { last_name: e.target.value })} />
              </div>
              {italian && (
                <>
                  <div>
                    <Label htmlFor={`att-passport-${index}`}>מספר דרכון</Label>
                    <Input id={`att-passport-${index}`} dir="ltr" autoComplete="off" disabled={disabled} value={a.passport ?? ""} onChange={(e) => set(index, { passport: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`att-nat-${index}`}>אזרחות (קוד מדינה, למשל IL)</Label>
                    <Input id={`att-nat-${index}`} dir="ltr" maxLength={2} disabled={disabled} value={a.nationality ?? ""} onChange={(e) => set(index, { nationality: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label htmlFor={`att-dob-${index}`}>תאריך לידה</Label>
                    <Input id={`att-dob-${index}`} dir="ltr" type="date" disabled={disabled} value={a.dob ?? ""} onChange={(e) => set(index, { dob: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`att-gender-${index}`}>מין</Label>
                    <select
                      id={`att-gender-${index}`}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      disabled={disabled}
                      value={a.gender ?? ""}
                      onChange={(e) => set(index, { gender: e.target.value === "M" || e.target.value === "F" ? e.target.value : undefined })}
                    >
                      <option value="">בחרו</option>
                      <option value="M">זכר</option>
                      <option value="F">נקבה</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor={`att-birth-${index}`}>מקום לידה</Label>
                    <Input id={`att-birth-${index}`} dir="ltr" disabled={disabled} value={a.birth_place ?? ""} onChange={(e) => set(index, { birth_place: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListingRow({ listing, selected, onSelect }: { listing: RankedListing; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn("w-full rounded-md border p-3 text-right transition-colors", selected ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          <bdi>{listing.category}</bdi>
          {listing.section && <span className="text-muted-foreground"> · אזור <bdi>{listing.section}</bdi></span>}
          {listing.row && <span className="text-muted-foreground"> · שורה <bdi>{listing.row}</bdi></span>}
        </div>
        <div className="font-bold" dir="ltr">
          {money(listing.pricePerTicketUsd)} × · {money(listing.totalUsd)}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span dir="ltr">{listing.ticketType || "-"}</span>
        <span dir="ltr">{listing.splitType || "-"}</span>
        {listing.deliveryDate && <span>מסירה עד <bdi>{listing.deliveryDate}</bdi></span>}
        {listing.instantDownload && <Badge variant="secondary">הורדה מיידית</Badge>}
        {listing.paper && <Badge variant="outline">כרטיס נייר</Badge>}
      </div>
      {listing.gapUsd !== null && (
        <div className={cn("mt-1 text-sm", listing.dearer ? "font-medium text-amber-700" : "text-emerald-700")}>
          {listing.dearer
            ? `יקר ב-${money(listing.gapUsd)}${listing.gapPct !== null ? ` (${listing.gapPct}%)` : ""} מהעלות שנמכרה`
            : `זול ב-${money(Math.abs(listing.gapUsd))} מהעלות שנמכרה`}
        </div>
      )}
      {listing.leadBooker && (
        <div className="mt-1 text-sm font-medium text-red-600">הליסטינג דורש Lead Booker - לבדוק מול TixStock לפני הזמנה</div>
      )}
      {listing.restrictions.length > 0 && (
        <ul className="mt-1 list-disc ps-5 text-xs" dir="ltr">
          {listing.restrictions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </button>
  );
}

export function TicketBookingDialog({
  reservationId,
  open,
  onOpenChange,
  onDone,
}: {
  reservationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a book click that reached TixStock (approved, refused, uncertain): the card reads the row again. */
  onDone: () => void;
}) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; error: string } | { kind: "pick_event" } | { kind: "ready"; data: Opened }>({ kind: "loading" });
  const [listingId, setListingId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<AttendeeInput[]>([]);
  const [shipping, setShipping] = useState<{ name: string; address: string }>({ name: "", address: "" });
  const [acks, setAcks] = useState({ flightHotelDone: false, notBoughtByHand: false, finalPurchase: false });
  const [acceptGap, setAcceptGap] = useState(false);
  // Staff's tick "האירוע דורש פרטי זיהוי". It can only ADD the identity details: when the venue is in Italy the
  // server requires them whatever is ticked here.
  const [identityTick, setIdentityTick] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TixstockEventHit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(
    async (tixstockEventId?: string) => {
      setState({ kind: "loading" });
      setBookError(null);
      try {
        const answer = await openTicketBooking(reservationId, tixstockEventId);
        if (answer.ok) {
          setState({ kind: "ready", data: answer });
          setListingId(null);
          setAttendees(answer.attendees);
          setShipping({ name: answer.hotelShipping?.name ?? "", address: answer.hotelShipping?.address ?? "" });
          setAcks({ flightHotelDone: false, notBoughtByHand: false, finalPurchase: false });
          setAcceptGap(false);
          setIdentityTick(false);
        } else if (answer.kind === "no_event") {
          // Our own stock or a hand-typed order: staff pick the TixStock event. An order sold from another
          // supplier is refused (`not_tixstock`) - it falls to the error line below, never to the picker.
          setState({ kind: "pick_event" });
        } else {
          setState({ kind: "error", error: OPEN_ERRORS[answer.kind] ?? OPEN_ERRORS.db });
        }
      } catch {
        setState({ kind: "error", error: OPEN_ERRORS.db });
      }
    },
    [reservationId],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const search = async () => {
    setSearching(true);
    try {
      setHits(await searchTixstockEvents(query));
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const data = state.kind === "ready" ? state.data : null;
  const all = data ? [...data.listings.sameCategory, ...data.listings.others] : [];
  const picked = all.find((l) => l.listingId === listingId) ?? null;
  const identityDetails = !!data && (data.italian || identityTick);
  const attendeesOk = !!data && attendees.length === data.quantity && attendees.every((a) => attendeeIssues(a, identityDetails).length === 0);
  const shippingOk = !picked?.paper || (shipping.name.trim() !== "" && shipping.address.trim() !== "");
  const canBook = !!data && !!picked && attendeesOk && shippingOk && acks.flightHotelDone && acks.notBoughtByHand && acks.finalPurchase && (!picked.dearer || acceptGap) && !booking;

  const book = async () => {
    if (!data || !picked || !canBook) return;
    setBooking(true);
    setBookError(null);
    try {
      const result = await bookReservationTicket({
        reservationId,
        tixstockEventId: data.tixstockEventId,
        listingId: picked.listingId,
        buyer: data.buyer,
        attendees,
        italian: identityDetails,
        ...(picked.paper ? { shippingAddress: { name: shipping.name, address: shipping.address } } : {}),
        acceptGap,
        acks,
      });
      if (result.ok) {
        onDone();
        onOpenChange(false);
        return;
      }
      setBookError(`${BOOK_ERRORS[result.kind] ?? BOOK_ERRORS.db}${result.kind === "refused" && result.message ? ` (${result.message})` : ""}`);
      // The row may have changed (failed, uncertain): the card shows what really happened.
      if (result.kind === "refused" || result.kind === "uncertain" || result.kind === "gone" || result.kind === "db") onDone();
      if (result.kind === "gone") void load(data.tixstockEventId);
    } catch {
      setBookError(BOOK_ERRORS.db);
      onDone();
    } finally {
      setBooking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            הזמנת כרטיסים ב-TixStock
            {data?.env === "sandbox" && <Badge variant="secondary">בדיקה - סנדבוקס</Badge>}
          </DialogTitle>
          <DialogDescription>
            {data ? `${data.quantity} כרטיסים${data.costSoldTotalUsd !== null ? ` · עלות שנמכרה: ${money(data.costSoldTotalUsd)}` : ""}` : "ליסטינגים חיים מהספק"}
          </DialogDescription>
        </DialogHeader>

        {state.kind === "loading" && (
          <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען ליסטינגים...
          </div>
        )}
        {state.kind === "error" && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}

        {state.kind === "pick_event" && (
          <div className="space-y-3">
            <p className="text-sm">להזמנה הזו אין מזהה אירוע של TixStock. חפשו את האירוע ובחרו אותו:</p>
            <div className="flex gap-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="שם האירוע ב-TixStock" dir="ltr" onKeyDown={(e) => e.key === "Enter" && void search()} />
              <Button type="button" variant="secondary" onClick={() => void search()} disabled={searching || query.trim().length < 2}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "חיפוש"}
              </Button>
            </div>
            <div className="space-y-1">
              {hits.map((hit) => (
                <button key={hit.event_id} type="button" className="w-full rounded-md border p-2 text-right text-sm hover:bg-muted/50" onClick={() => void load(hit.event_id)}>
                  <bdi className="font-medium">{hit.event_name}</bdi>
                  <span className="text-muted-foreground"> · <bdi>{hit.show_date.slice(0, 10)}</bdi> · <bdi>{hit.venue_name}</bdi></span>
                </button>
              ))}
            </div>
          </div>
        )}

        {data && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="font-medium">הקטגוריה שנמכרה</h3>
              {data.listings.sameCategory.length === 0 && <p className="text-sm text-muted-foreground">אין כרגע ליסטינג בקטגוריה שנמכרה.</p>}
              {data.listings.sameCategory.map((l) => (
                <ListingRow key={l.listingId} listing={l} selected={l.listingId === listingId} onSelect={() => { setListingId(l.listingId); setAcceptGap(false); }} />
              ))}
              {data.listings.others.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
                    <ChevronDown className="h-4 w-4" /> קטגוריות אחרות ({data.listings.others.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    {data.listings.others.map((l) => (
                      <ListingRow key={l.listingId} listing={l} selected={l.listingId === listingId} onSelect={() => { setListingId(l.listingId); setAcceptGap(false); }} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">נוסעים</h3>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={identityDetails} disabled={data.italian || booking} onCheckedChange={(v) => setIdentityTick(v === true)} />
                האירוע דורש פרטי זיהוי
                {data.italian && <span className="text-muted-foreground">(האצטדיון באיטליה - חובה)</span>}
              </label>
              <AttendeesEditor attendees={attendees} italian={identityDetails} onChange={setAttendees} disabled={booking} />
              {attendees.length !== data.quantity && (
                <p className="text-sm text-red-600">מספר הנוסעים ({attendees.length}) לא תואם את מספר הכרטיסים ({data.quantity}).</p>
              )}
            </section>

            {picked?.paper && (
              <section className="space-y-2">
                <h3 className="font-medium">כתובת למשלוח (כרטיס נייר)</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="ship-name">שם המלון / הנמען</Label>
                    <Input id="ship-name" dir="ltr" value={shipping.name} onChange={(e) => setShipping({ ...shipping, name: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="ship-address">כתובת</Label>
                    <Input id="ship-address" dir="ltr" value={shipping.address} onChange={(e) => setShipping({ ...shipping, address: e.target.value })} />
                  </div>
                </div>
              </section>
            )}

            <section className="space-y-2">
              {picked?.dearer && (
                <label className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
                  <Checkbox checked={acceptGap} onCheckedChange={(v) => setAcceptGap(v === true)} />
                  הליסטינג יקר ב-{money(picked.gapUsd ?? 0)} מהעלות שנמכרה - מאשר/ת לקנות בכל זאת
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={acks.flightHotelDone} onCheckedChange={(v) => setAcks({ ...acks, flightHotelDone: v === true })} />
                הטיסה והמלון של ההזמנה סגורים
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={acks.notBoughtByHand} onCheckedChange={(v) => setAcks({ ...acks, notBoughtByHand: v === true })} />
                הכרטיסים להזמנה הזו לא נרכשו כבר ידנית
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={acks.finalPurchase} onCheckedChange={(v) => setAcks({ ...acks, finalPurchase: v === true })} />
                ברור לי שזו רכישה סופית
              </label>
              <p className="text-sm font-bold text-red-600">רכישה סופית - הזמנה מאושרת ב-TixStock לא מתבטלת</p>
              {bookError && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">{bookError}</p>}
              <Button type="button" className="w-full" disabled={!canBook} onClick={() => void book()}>
                {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : "הזמן כרטיס"}
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
