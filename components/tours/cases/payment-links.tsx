"use client";

/**
 * An order's card payment links (Alon's "סליקה אשראי לחבר", 28.10.2026; spec
 * docs/superpowers/specs/2026-10-28-tours-card-payments-design.md). "Payment link" makes one - a deposit ($200 per
 * traveler by default, Dor), the balance or another amount - and the rep sends it on WhatsApp / e-mail or opens it
 * to take a card on the phone. The customer types the card on CreditGuard's page only; the paid amount writes itself
 * into the payments above. Rules are pure in lib/tours/payment-links.ts; writes go through
 * lib/actions/tours-payment-link-actions.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Link2, Loader2, Mail, MessageCircle, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtPrice } from "@/lib/tours/format";
import { whatsappAppLink } from "@/lib/tours/cases";
import { cancelPaymentLink, createPaymentLink, markPaymentLinkSent } from "@/lib/actions/tours-payment-link-actions";
import {
  LINK_DAYS_DEFAULT,
  LINK_DAYS_MAX,
  LINK_KINDS,
  LINK_KIND_LABELS,
  LINK_PAYMENTS_MAX,
  LINK_STATE_LABELS,
  dayMonth,
  defaultLinkAmount,
  customerOrderNumber,
  firstNameOf,
  isLiveLink,
  linkBlockedBy,
  openLinksTotal,
  payLinkMessage,
  type LinkKind,
  type LinkState,
  type PaymentLinkView,
} from "@/lib/tours/payment-links";
import type { BookingRow } from "@/components/tours/bookings/shared";

const STATE_CLASSES: Record<LinkState, string> = {
  open: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  started: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  paid: "bg-green-500/10 text-green-700 dark:text-green-300",
  review: "bg-red-500/10 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
};

type Draft = { kind: LinkKind; amount: string; payments: string; days: string };

/** The order summary's "Card payment link" button opens this order's dialog here (Dor 28.10: a pay button in the summary). */
const OPEN_EVENT = "tours:open-payment-link";
export function openPaymentLinkDialog(bookingId: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: bookingId }));
}

export function PaymentLinks({ booking, due, onChanged }: { booking: BookingRow; due: number; onChanged: () => void }) {
  const run = useActionToast();
  const confirm = useConfirm();
  const [links, setLinks] = useState<PaymentLinkView[]>(booking.paymentLinks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [made, setMade] = useState<PaymentLinkView | null>(null);
  const [busy, setBusy] = useState(false);
  // what is still owed minus what the open links already ask for - the server counts the same way
  const owed = Math.round((due - openLinksTotal(links, booking.currency)) * 100) / 100;
  const order = { status: booking.status, currency: booking.currency, travelers: booking.adults + booking.children, due: owed };
  const blocked = linkBlockedBy(order);

  const draftFor = (kind: LinkKind): Draft => {
    const amount = defaultLinkAmount(kind, order);
    return { kind, amount: amount == null ? "" : String(amount), payments: "1", days: String(LINK_DAYS_DEFAULT) };
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch });
  const open = () => {
    setMade(null);
    setDraft(draftFor("deposit"));
  };
  const close = () => {
    setDraft(null);
    setMade(null);
  };
  // the summary's button (an event, so the list and the dialog keep one state)
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === booking.id) openRef.current();
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [booking.id]);

  const create = async () => {
    if (!draft) return;
    setBusy(true);
    const result = await run(
      () =>
        createPaymentLink(booking.id, {
          kind: draft.kind,
          amount: Number(draft.amount.replace(/,/g, "")),
          payments: draft.kind === "deposit" ? 1 : Number(draft.payments),
          days: Number(draft.days),
        }),
      "Payment link ready",
    );
    setBusy(false);
    if (!result.success) return;
    setLinks(result.data.links);
    setMade(result.data.link);
    setDraft(null);
    onChanged();
  };

  const sent = async (link: PaymentLinkView) => {
    const result = await markPaymentLinkSent(link.id);
    if (result.success) setLinks(result.data);
  };
  const cancel = async (link: PaymentLinkView) => {
    const agreed = await confirm({
      title: "Cancel this payment link?",
      description: `${LINK_KIND_LABELS[link.kind]} of ${fmtPrice(link.amount, link.currency)}. The customer will not be able to pay through it.`,
      confirmLabel: "Cancel the link",
      destructive: true,
    });
    if (!agreed) return;
    setBusy(true);
    const result = await run(() => cancelPaymentLink(link.id), "Link cancelled");
    setBusy(false);
    if (result.success) {
      setLinks(result.data);
      onChanged();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" /> Card payment links
        </h5>
        <Button size="sm" variant="outline" className="ms-auto" disabled={busy || !!blocked} title={blocked ?? undefined} onClick={open}>
          <Link2 className="h-4 w-4" />
          Payment link
        </Button>
      </div>

      {links.length > 0 && (
        <ul className="divide-y rounded-md border bg-background text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
              <span className="font-medium">{LINK_KIND_LABELS[l.kind]}</span>
              <span className="tabular">{fmtPrice(l.amount, l.currency)}</span>
              {l.payments > 1 && <span className="text-xs text-muted-foreground">{l.payments} payments</span>}
              <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATE_CLASSES[l.state])}>{LINK_STATE_LABELS[l.state]}</span>
              <span className="text-xs text-muted-foreground">
                {l.state === "paid" && l.paidAt
                  ? `paid ${dayMonth(l.paidAt)}${l.cardLast4 ? ` · card ••${l.cardLast4}` : ""}${l.amountIls != null ? ` · ${fmtPrice(l.amountIls, "ILS")}` : ""}`
                  : isLiveLink(l.state)
                    ? `until ${dayMonth(l.expiresAt)}${l.sentAt ? ` · sent ${dayMonth(l.sentAt)}` : " · not sent"}${l.attempts ? ` · ${l.attempts} failed` : ""}`
                    : `made ${dayMonth(l.createdAt)}`}
                {l.createdBy && ` · by ${l.createdBy}`}
              </span>
              {l.lastError && (l.state === "review" || l.state === "paid") && (
                <span dir="auto" className="basis-full whitespace-pre-line text-xs text-red-700 dark:text-red-300">
                  {l.lastError}
                </span>
              )}
              {isLiveLink(l.state) && (
                <span className="ms-auto flex items-center gap-1">
                  <SendLink booking={booking} link={l} onSent={() => void sent(l)} compact />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={busy} aria-label="Cancel the link" onClick={() => void cancel(l)}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft || !!made} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          {draft && (
            <>
              <DialogHeader>
                <DialogTitle>Card payment link · {booking.ref}</DialogTitle>
                <DialogDescription>
                  The customer pays on the company site, on the card company&apos;s secure page. Still owed: {fmtPrice(due, booking.currency)}
                  {owed !== due && `, of which ${fmtPrice(due - owed, booking.currency)} is on links still open`}.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>For</Label>
                  <Select value={draft.kind} onValueChange={(kind) => setDraft(draftFor(kind as LinkKind))}>
                    <SelectTrigger aria-label="What the payment is for">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LINK_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {LINK_KIND_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount ({booking.currency})</Label>
                  <Input inputMode="decimal" dir="ltr" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} autoFocus />
                  {draft.kind === "deposit" && booking.currency === "USD" && (
                    <p className="text-xs text-muted-foreground">$200 × {order.travelers} travelers</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Payments</Label>
                  <Select value={draft.kind === "deposit" ? "1" : draft.payments} disabled={draft.kind === "deposit"} onValueChange={(payments) => set({ payments })}>
                    <SelectTrigger aria-label="Payments">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: LINK_PAYMENTS_MAX }, (_, i) => String(i + 1)).map((n) => (
                        <SelectItem key={n} value={n}>
                          {n === "1" ? "One payment" : `${n} payments`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Valid for (days)</Label>
                  <Input inputMode="numeric" dir="ltr" value={draft.days} onChange={(e) => set({ days: e.target.value })} />
                  <p className="text-xs text-muted-foreground">1 to {LINK_DAYS_MAX}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Charged in shekels at the rate of the moment the customer pays. The card&apos;s status stays yours to move.</p>
              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={busy}>
                  Close
                </Button>
                <Button onClick={() => void create()} disabled={busy || !draft.amount.trim()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Make the link
                </Button>
              </DialogFooter>
            </>
          )}
          {made && (
            <>
              <DialogHeader>
                <DialogTitle>The link is ready</DialogTitle>
                <DialogDescription>
                  {LINK_KIND_LABELS[made.kind]} of {fmtPrice(made.amount, made.currency)}, valid until {dayMonth(made.expiresAt)}. Send it, or open it to take
                  the card with the customer on the phone.
                </DialogDescription>
              </DialogHeader>
              {made.url && (
                <Input readOnly dir="ltr" value={made.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              )}
              <div className="flex flex-wrap gap-2">
                <SendLink booking={booking} link={made} onSent={() => void sent(made)} />
              </div>
              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Copy / WhatsApp (the rep's own app) / e-mail / open. WhatsApp and e-mail count as sent; copying does not. */
function SendLink({ booking, link, onSent, compact }: { booking: BookingRow; link: PaymentLinkView; onSent: () => void; compact?: boolean }) {
  const run = useActionToast();
  if (!link.url) return <span className="text-xs text-muted-foreground">The company has no site address</span>;
  const url = link.url;
  const message = payLinkMessage({ firstName: firstNameOf(booking.customerName), kind: link.kind, amount: link.amount, currency: link.currency, ref: booking.ref, url, expiresAt: link.expiresAt });
  const wa = whatsappAppLink(booking.customerPhone, message);
  const mail = booking.customerEmail
    ? `mailto:${encodeURIComponent(booking.customerEmail)}?subject=${encodeURIComponent(`תשלום להזמנה ${customerOrderNumber(booking.ref)}`)}&body=${encodeURIComponent(message)}`
    : null;
  const copy = () => void run(async () => {
    await navigator.clipboard.writeText(url);
    return { success: true as const, data: undefined };
  }, "Link copied");
  const size = compact ? "icon" : "sm";
  const cls = compact ? "h-7 w-7" : undefined;
  return (
    <>
      <Button variant={compact ? "ghost" : "outline"} size={size} className={cls} onClick={copy} aria-label="Copy the link">
        <Copy className="h-3.5 w-3.5" />
        {!compact && "Copy"}
      </Button>
      {wa && (
        <Button variant={compact ? "ghost" : "outline"} size={size} className={cn(cls, "text-success hover:text-success")} asChild>
          <a href={wa} onClick={onSent} aria-label="Send on WhatsApp" title="Opens WhatsApp on this computer">
            <MessageCircle className="h-3.5 w-3.5" />
            {!compact && "WhatsApp"}
          </a>
        </Button>
      )}
      {mail && (
        <Button variant={compact ? "ghost" : "outline"} size={size} className={cls} asChild>
          <a href={mail} onClick={onSent} aria-label="Send by e-mail">
            <Mail className="h-3.5 w-3.5" />
            {!compact && "E-mail"}
          </a>
        </Button>
      )}
      <Button variant={compact ? "ghost" : "outline"} size={size} className={cls} asChild>
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open the payment page" title="Take the card on the phone">
          <ExternalLink className="h-3.5 w-3.5" />
          {!compact && "Open"}
        </a>
      </Button>
    </>
  );
}
