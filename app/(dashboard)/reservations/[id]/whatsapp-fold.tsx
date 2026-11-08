"use client";

/**
 * The order's WhatsApp section (spec 2026-11-08 section 8): the conversation of the order's phone and any chat attached
 * to it, the reply box, "טופל", the "no WhatsApp" switch (D-6) and the automatic messages of the order with their
 * outcome. Folded; it reads nothing until opened, then ONE action. Opening it marks its chats seen.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { CheckCheck, ChevronDown, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { fmtInstant } from "@/lib/tours/format";
import { ThreadView } from "@/components/whatsapp/thread-view";
import { ReplyBox } from "@/components/whatsapp/reply-box";
import { WhatsAppButton } from "@/components/tours/cases/case-ui";
import { markChatHandled, reservationWhatsapp, setReservationWhatsappOff, type ReservationWhatsapp } from "@/lib/actions/whatsapp-events-actions";
import { foldTargets } from "@/lib/whatsapp/events/chat-rules";

const KIND_LABELS: Record<string, string> = {
  payment_received: "התשלום התקבל",
  payment_failed: "התשלום לא עבר",
  phone_order: "הזמנה טלפונית התקבלה",
  materials_sent: "החומר נשלח",
  order_cancelled: "ההזמנה בוטלה",
  flight_reminder: "תזכורת לפני הטיסה",
  event_today: "היום זה קורה",
  after_trip: "איך היה?",
  cart_reminder: "תזכורת להשלמת ההזמנה",
};

function outcomeLabel(line: ReservationWhatsapp["outbox"][number]): string {
  // a trial send says so in its reason ("נשלח לטלפון הניסיון" - the drain writes it)
  if (line.status === "sent") return line.reason || "נשלח";
  if (line.status === "pending") return "ממתין";
  if (line.status === "skipped") return `לא נשלח: ${line.reason ?? ""}`;
  return `נכשל: ${line.reason ?? ""}`;
}

export function WhatsappFold({ reservationId, phone }: { reservationId: number; phone: string | null }) {
  const run = useActionToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReservationWhatsapp | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await run(() => reservationWhatsapp(reservationId));
    setLoading(false);
    if (res.success && res.data) setData(res.data);
  }, [reservationId, run]);

  // each chat answered on its own: a reply to a companion never goes to the customer, each has its own window
  const targets = data ? foldTargets(data.chats, data.phoneKey) : [];
  const unseen = !!data?.chats.some((c) => c.lastInAt && (!c.seenAt || c.lastInAt > c.seenAt));

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !data) void load();
      }}
    >
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
                {unseen && <span className="h-2 w-2 rounded-full bg-primary" aria-label="הודעה חדשה" />}
              </CardTitle>
              <CardDescription>השיחה עם הטלפון של ההזמנה, וההודעות האוטומטיות שלה</CardDescription>
            </div>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4" dir="rtl">
            {loading && !data && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            {data && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!!data.off}
                      disabled={busy}
                      onCheckedChange={async (next) => {
                        setBusy(true);
                        const res = await run(() => setReservationWhatsappOff(reservationId, next), next ? "לא יישלח וואטסאפ להזמנה" : "וואטסאפ הופעל להזמנה");
                        setBusy(false);
                        if (res.success) setData({ ...data, off: next ? { at: new Date().toISOString(), by: null } : null });
                      }}
                    />
                    לא לשלוח וואטסאפ להזמנה הזו
                  </label>
                  <span className="ms-auto">
                    <WhatsAppButton phone={phone} message="" iconOnly />
                  </span>
                </div>
                {data.thread.messages.length > 0 ? (
                  <ThreadView messages={data.thread.messages} hasMore={false} />
                ) : (
                  <p className="text-sm text-muted-foreground">{data.thread.connected ? "אין הודעות עם הטלפון הזה." : "המספר של החברה עדיין לא מחובר."}</p>
                )}
                {targets.map((t) => (
                  <div key={t.chatId} className="space-y-2 rounded-md border p-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{t.own ? "הלקוח" : "מצורף להזמנה"}</span>
                      <span className="text-muted-foreground" dir="ltr">
                        {t.phone}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ms-auto"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          const res = await run(() => markChatHandled(t.chatId), "סומן כטופל");
                          setBusy(false);
                          if (res.success) void load();
                        }}
                      >
                        <CheckCheck className="h-4 w-4" />
                        טופל
                      </Button>
                      <Link href={`/whatsapp?chat=${t.chatId}`} className="underline">
                        פתח במסך הוואטסאפ
                      </Link>
                    </div>
                    <ReplyBox chatId={t.chatId} reservationId={reservationId} lastInAt={t.lastInAt} onSent={() => void load()} />
                  </div>
                ))}
                {data.outbox.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">הודעות אוטומטיות</p>
                    <ul className="space-y-1 text-sm">
                      {data.outbox.map((l, i) => (
                        <li key={`${l.kind}-${i}`} className="flex flex-wrap gap-2">
                          <span>{KIND_LABELS[l.kind] ?? l.kind}</span>
                          <span className={cn("text-muted-foreground", l.status === "failed" && "text-destructive")}>{outcomeLabel(l)}</span>
                          <span className="text-muted-foreground" dir="ltr">{fmtInstant(l.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
