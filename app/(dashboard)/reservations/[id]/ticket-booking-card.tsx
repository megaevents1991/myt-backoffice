"use client";

/**
 * The TixStock ticket-booking card of a reservation: the booking's status, the listing as booked, the tickets the
 * seller sent, and what staff do with them - check, send to the customer, refresh, settle an uncertain order.
 *
 * It renders NOTHING unless `getTicketBooking` answers `ok`: for every role the fulfilment tools are not open to
 * (the action answers `hidden`), on a read error, and when the call itself rejects. The reservation page then
 * looks exactly as it did before this card existed.
 * Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.3-7.6.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  getTicketBooking,
  markTicketsChecked,
  markWhatsappSent,
  refreshTicketBooking,
  resolveUncertain,
  sendTicketsToCustomer,
  updateTicketAttendees,
} from "@/lib/actions/ticket-booking-actions";
import type { TicketBookingView, TicketFileView } from "@/lib/tixstock-booking/booking-view";
import { seatsLine, whatsappTicketText } from "@/lib/tixstock-booking/customer-email";
import type { BookingAvailability } from "@/lib/tixstock-booking/office-open";
import type { AttendeeInput, BookingStatus } from "@/lib/tixstock-booking/rules";
import { AttendeesEditor, TicketBookingDialog } from "./ticket-booking-dialog";

const STATUS_LABEL: Record<BookingStatus, string> = {
  holding: "מחזיק כרטיסים",
  on_hold: "כרטיסים מוחזקים",
  ordering: "מזמין",
  sale_on_hold: "הוזמן - ממתין לאישור",
  approved: "מאושר",
  commissionable: "הושלם - כרטיסים התקבלו",
  failed: "נכשל",
  released: "שוחרר",
  uncertain: "לא ודאי",
  cancelled: "בוטל על ידי TixStock",
};

const FILE_LABEL: Record<string, string> = {
  pdf: "כרטיס (PDF)",
  mobile_link: "כרטיס לנייד",
  proof: "הוכחת העברה",
  additional: "הנחיות מהמוכר",
};

const ACTION_ERRORS: Record<string, string> = {
  hidden: "אין הרשאה.",
  not_found: "ההזמנה לא נמצאה.",
  no_files: "עדיין לא התקבלו כרטיסים.",
  not_checked: "יש לסמן קודם שהכרטיסים נבדקו.",
  not_sendable: "אי אפשר לשלוח כרטיסים של הזמנה שנכשלה או בוטלה.",
  no_email: "להזמנה אין כתובת מייל.",
  no_order: "אין עדיין הזמנה ב-TixStock.",
  attendees: "פרטי הנוסעים חסרים או לא תואמים את מספר הכרטיסים.",
  refused: "TixStock סירב לבקשה.",
  supplier: "TixStock לא ענה. נסו שוב בעוד רגע.",
  production_closed: "TixStock - הזמנה בפרודקשן עוד לא נפתחה",
  not_configured: "אין חיבור ל-TixStock בסביבה הזו.",
  not_uncertain: "ההזמנה כבר לא במצב לא ודאי.",
  order_id: "יש להזין את מזהה ההזמנה מ-TixStock.",
  db: "הפעולה נכשלה. נסו שוב.",
};

/** Why "הזמן כרטיס" cannot be pressed for this reservation. The button is then drawn disabled, with this line. */
const UNAVAILABLE: Record<Extract<BookingAvailability, { available: false }>["reason"], string> = {
  production_closed: "TixStock - הזמנה בפרודקשן עוד לא נפתחה",
  not_configured: "אין חיבור ל-TixStock בסביבה הזו",
  test_without_sandbox: "אירוע בדיקה בלי מצב סנדבוקס - לא מזמינים ממנו כרטיסים",
};

const money = (n: number | null): string => (n === null ? "-" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString("he-IL") : "");

/** Open bookings: the reservation has a live one, so "הזמן כרטיס" is not offered. */
const LIVE: readonly BookingStatus[] = ["holding", "on_hold", "ordering", "sale_on_hold", "approved", "commissionable", "uncertain"];

export function TicketBookingCard({ reservationId, eventName }: { reservationId: number; eventName: string }) {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<{ booking: TicketBookingView | null; files: TicketFileView[]; availability: BookingAvailability } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AttendeeInput[] | null>(null);
  const [uncertainOrderId, setUncertainOrderId] = useState("");
  const [uncertainNote, setUncertainNote] = useState("");

  const load = useCallback(async () => {
    try {
      const answer = await getTicketBooking(reservationId);
      setLoaded(answer.ok ? { booking: answer.booking, files: answer.files, availability: answer.availability } : null);
    } catch {
      // Hidden, a read error or a rejected call: the page stays exactly as it was.
      setLoaded(null);
    }
  }, [reservationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one of the card's actions, says what happened, and reads the row again. */
  const run = async (name: string, action: () => Promise<{ ok: true } | { ok: false; kind: string }>, okMessage: string) => {
    setBusy(name);
    try {
      const result = await action();
      if (result.ok) toast({ title: okMessage });
      else toast({ variant: "destructive", title: ACTION_ERRORS[result.kind] ?? ACTION_ERRORS.db });
    } catch {
      toast({ variant: "destructive", title: ACTION_ERRORS.db });
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!loaded) return null;
  const { booking, files, availability } = loaded;
  const live = !!booking && LIVE.includes(booking.status);
  const tickets = files.filter((f) => f.kind === "pdf" || f.kind === "mobile_link");
  const waiting = !!booking && booking.source === "office" && files.length > 0 && !booking.sentToCustomerAt;

  return (
    <Card dir="rtl" data-ticket-booking-card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Ticket className="h-5 w-5" />
          כרטיסים - TixStock
          {booking?.env === "sandbox" && <Badge variant="secondary">בדיקה - סנדבוקס</Badge>}
          {booking && <Badge variant={booking.status === "failed" || booking.status === "cancelled" ? "destructive" : "outline"}>{STATUS_LABEL[booking.status]}</Badge>}
          {booking?.source === "site" && <Badge variant="outline">הוזמן מהאתר</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!live && (
          <div className="space-y-2">
            {booking?.lastError && <p className="text-red-600">ניסיון קודם: <bdi dir="ltr">{booking.lastError}</bdi></p>}
            {/* Disabled wherever the book action would refuse anyway: today, every real (production) order. */}
            <Button type="button" disabled={!availability.available} onClick={() => availability.available && setDialogOpen(true)}>
              הזמן כרטיס
            </Button>
            {!availability.available && <p className="text-muted-foreground" data-ticket-booking-unavailable>{UNAVAILABLE[availability.reason]}</p>}
          </div>
        )}

        {booking && (
          <>
            {waiting && <p className="rounded-md border border-emerald-400 bg-emerald-50 p-2 font-medium text-emerald-900">כרטיסים התקבלו - לבדוק ולשלוח</p>}
            {booking.saleOnHoldMinutes !== null && booking.saleOnHoldMinutes > 90 && (
              <p className="rounded-md border border-red-400 bg-red-50 p-2 font-medium text-red-800">
                ההזמנה ממתינה לאישור כבר {booking.saleOnHoldMinutes} דקות - TixStock מצפה לאישור בתוך שעתיים
              </p>
            )}

            {booking.status === "uncertain" && (
              <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-900">
                <p className="font-bold">לא ודאי - לא להזמין שוב עד שיתברר</p>
                <p>בודקים ב-Request Logs של TixStock אם ההזמנה נוצרה</p>
                <p>המזהה שלנו בבקשה: <bdi dir="ltr" className="font-mono">{booking.ourOrderId}</bdi></p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="max-w-[220px] bg-white" dir="ltr" placeholder="מזהה ההזמנה ב-TixStock" value={uncertainOrderId} onChange={(e) => setUncertainOrderId(e.target.value)} />
                  <Input className="max-w-[260px] bg-white" placeholder="הערה" value={uncertainNote} onChange={(e) => setUncertainNote(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy !== null || uncertainOrderId.trim() === ""}
                    onClick={() => void run("resolve", () => resolveUncertain(booking.id, { created: true, orderId: uncertainOrderId }, uncertainNote), "נרשם: ההזמנה נוצרה")}
                  >
                    בדקתי - נוצרה הזמנה {uncertainOrderId.trim()}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void run("resolve", () => resolveUncertain(booking.id, { created: false }, uncertainNote), "נרשם: ההזמנה לא נוצרה")}
                  >
                    בדקתי - לא נוצרה
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-1 md:grid-cols-2">
              <p><strong>המזהה שלנו ב-TixStock:</strong> <bdi dir="ltr" className="font-mono">{booking.ourOrderId}</bdi></p>
              <p><strong>מזהה ההזמנה של TixStock:</strong> <bdi dir="ltr" className="font-mono">{booking.tixstockOrderId ?? "-"}</bdi></p>
              <p><strong>מיקום:</strong> <bdi>{seatsLine(booking.listing) || "-"}</bdi></p>
              <p><strong>כמות:</strong> {booking.quantity}</p>
              <p><strong>סוג כרטיס:</strong> <bdi dir="ltr">{booking.listing.ticketType || "-"}</bdi> · <bdi dir="ltr">{booking.listing.splitType || "-"}</bdi></p>
              <p><strong>מסירה עד:</strong> <bdi dir="ltr">{booking.listing.deliveryDate ?? "-"}</bdi>{booking.listing.instantDownload ? " · הורדה מיידית" : ""}</p>
              <p><strong>עלות בפועל:</strong> <bdi dir="ltr">{money(booking.orderTotal ?? booking.total)}</bdi> ({money(booking.pricePerTicket)} לכרטיס)</p>
              <p><strong>עלות שנמכרה:</strong> <bdi dir="ltr">{money(booking.costSoldUsd)}</bdi></p>
              <p><strong>קונה:</strong> <bdi>{booking.buyer.first_name} {booking.buyer.last_name}</bdi> · <bdi dir="ltr">{booking.buyer.email}</bdi></p>
              <p><strong>נוצר:</strong> {when(booking.createdAt)}</p>
            </div>
            {booking.listing.restrictions.length > 0 && (
              <div>
                <strong>הגבלות והטבות:</strong>
                <ul className="list-disc ps-5" dir="ltr">
                  {booking.listing.restrictions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <strong>נוסעים:</strong>
              {editing ? (
                <div className="mt-2 space-y-2">
                  <AttendeesEditor attendees={editing} italian={booking.listing.italian} onChange={setEditing} disabled={busy !== null} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void run("attendees", () => updateTicketAttendees(booking.id, editing), "הנוסעים עודכנו ב-TixStock").then(() => setEditing(null))}
                    >
                      שמור ושלח ל-TixStock
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>ביטול</Button>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="list-disc ps-5">
                    {booking.attendees.map((a, i) => (
                      <li key={i}>
                        <bdi dir="ltr">{a.first_name} {a.last_name}</bdi>
                        {a.passport ? <span className="text-muted-foreground"> · דרכון <bdi dir="ltr">{a.passport}</bdi></span> : null}
                      </li>
                    ))}
                  </ul>
                  {booking.tixstockOrderId && (
                    <Button type="button" size="sm" variant="link" className="px-0" onClick={() => setEditing(booking.attendees)}>עדכון נוסעים</Button>
                  )}
                </>
              )}
            </div>

            <div>
              <strong>קבצים שהתקבלו:</strong>
              {files.length === 0 ? (
                <span className="text-muted-foreground"> עדיין לא התקבלו</span>
              ) : (
                <ul className="list-disc ps-5">
                  {files.map((f) => (
                    <li key={f.id}>
                      {FILE_LABEL[f.kind] ?? f.kind}
                      {f.row ? ` · שורה ${f.row}` : ""}
                      {f.seat ? ` · מושב ${f.seat}` : ""}
                      {" · "}
                      {f.href ? (
                        <a className="underline underline-offset-4" href={f.href} target="_blank" rel="noopener noreferrer">פתיחה</a>
                      ) : f.text ? (
                        // A seller's link that is not an http(s) URL: shown as text, never as a link.
                        <bdi dir="ltr" className="font-mono text-xs">{f.text}</bdi>
                      ) : (
                        <span className="text-muted-foreground">לא זמין</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {booking.source === "office" && tickets.length + files.filter((f) => f.kind === "proof").length > 0 && !booking.checkedAt && (
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => void run("check", () => markTicketsChecked(booking.id), "סומן: הכרטיסים נבדקו")}>
                  {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : "בדקתי את הכרטיסים"}
                </Button>
              )}
              {booking.checkedAt && (
                <>
                  <span className="text-muted-foreground">נבדק {when(booking.checkedAt)}{booking.checkedBy ? ` · ${booking.checkedBy}` : ""}</span>
                  <Button type="button" size="sm" disabled={busy !== null} onClick={() => void run("send", () => sendTicketsToCustomer(booking.id), "המייל נשלח ללקוח")}>
                    {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : "שלח ללקוח"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(whatsappTicketText({ eventName, pageUrl: booking.customerPageUrl }))
                        .then(() => toast({ title: "הטקסט הועתק" }))
                        .catch(() => toast({ variant: "destructive", title: "ההעתקה נכשלה" }));
                    }}
                  >
                    העתק לוואטסאפ
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("whatsapp", () => markWhatsappSent(booking.id), "נרשם: נשלח בוואטסאפ")}>
                    נשלח בוואטסאפ
                  </Button>
                </>
              )}
              {booking.tixstockOrderId && (
                <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("refresh", () => refreshTicketBooking(booking.id), "עודכן מ-TixStock")}>
                  {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  רענן
                </Button>
              )}
            </div>
            {booking.sentToCustomerAt && (
              <p className="text-muted-foreground">
                נשלח ללקוח {when(booking.sentToCustomerAt)} ({booking.sentChannels.join(", ")}) · <a className="underline underline-offset-4" href={booking.customerPageUrl} target="_blank" rel="noopener noreferrer">דף הכרטיסים של הלקוח</a>
              </p>
            )}
          </>
        )}
      </CardContent>
      <TicketBookingDialog reservationId={reservationId} open={dialogOpen} onOpenChange={setDialogOpen} onDone={() => void load()} />
    </Card>
  );
}
