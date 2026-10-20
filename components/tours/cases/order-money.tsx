"use client";

/**
 * An order's money as Alon drew it (20.10.2026): the balance on the order's line, the payments as a statement
 * (who, when, what, paid or scheduled, how much, invoice), a form to record one, and what cancelling costs today
 * by the tour's fee rules. Rules are pure in lib/tours/payments.ts and lib/tours/cancellation.ts; writes go
 * through lib/actions/tours-payments-actions.ts.
 */
import { useState, type ReactNode } from "react";
import { CreditCard, Loader2, Pencil, PlusCircle, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { EMPTY, fmtDate, fmtPrice, isoToJerusalemLocal, todayIso } from "@/lib/tours/format";
import { addBookingPayment, deleteBookingPayment, updateBookingPayment } from "@/lib/actions/tours-payments-actions";
import {
  PAYMENT_KINDS,
  PAYMENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  STAFF_PAYMENT_METHODS,
  balanceTone,
  orderBalance,
  type OrderPayment,
  type PaymentInput,
} from "@/lib/tours/payments";
import { CANCEL_COMPONENT_LABELS, cancellationFeeToday, ruleFeeText, type CancellationRule } from "@/lib/tours/cancellation";
import type { BookingRow } from "@/components/tours/bookings/shared";

const BALANCE_CHIP = {
  owed: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  settled: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  over: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
} as const;

/** "Balance −$1,605.74" on an order's line - red while money is owed, green once paid in full. */
export function BalanceChip({ booking, className }: { booking: Pick<BookingRow, "total" | "currency" | "paymentLog">; className?: string }) {
  const balance = orderBalance(booking.total, booking.currency, booking.paymentLog);
  const tone = balanceTone(balance);
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-semibold tabular", BALANCE_CHIP[tone], className)}
      title={`Total ${fmtPrice(balance.total, balance.currency)} · paid ${fmtPrice(balance.paid, balance.currency)}${balance.scheduled ? ` · scheduled ${fmtPrice(balance.scheduled, balance.currency)}` : ""}`}
    >
      {tone === "owed" ? `Balance −${fmtPrice(balance.due, balance.currency)}` : tone === "over" ? `Overpaid ${fmtPrice(-balance.due, balance.currency)}` : "Paid in full"}
    </span>
  );
}

/** A rep's past days are stored at noon UTC: their hour is not known, so it is not shown. */
const knownTime = (iso: string | null) => !!iso && !/T12:00:00(\.000)?(Z|\+00:00)$/.test(iso);

type Draft = {
  kind: string;
  status: string;
  amount: string;
  amountIls: string;
  paidOn: string;
  dueDate: string;
  method: string;
  payerName: string;
  invoiceNo: string;
  note: string;
};
const emptyDraft = (due: number): Draft => ({
  kind: "deposit",
  status: "paid",
  amount: due > 0 ? String(due) : "",
  amountIls: "",
  paidOn: todayIso(),
  dueDate: "",
  method: "transfer",
  payerName: "",
  invoiceNo: "",
  note: "",
});
const draftOf = (p: OrderPayment): Draft => ({
  kind: p.kind,
  status: p.status,
  amount: String(p.amount),
  amountIls: p.amountIls == null ? "" : String(p.amountIls),
  paidOn: p.paidAt ? isoToJerusalemLocal(p.paidAt).slice(0, 10) : todayIso(),
  dueDate: p.dueDate ?? "",
  method: p.method ?? "",
  payerName: p.payerName ?? "",
  invoiceNo: p.invoiceNo ?? "",
  note: p.note ?? "",
});
const inputOf = (d: Draft): PaymentInput => ({
  kind: d.kind,
  status: d.status,
  amount: Number(d.amount),
  amountIls: d.amountIls.trim() === "" ? null : Number(d.amountIls),
  paidOn: d.status === "paid" ? d.paidOn : null,
  dueDate: d.status === "scheduled" ? d.dueDate : null,
  method: d.method || null,
  payerName: d.payerName,
  invoiceNo: d.invoiceNo,
  note: d.note,
});

/** The order's payments as a statement, with a form to record one (Alon 20.10). */
export function OrderPayments({ booking, onChanged }: { booking: BookingRow; onChanged: () => void }) {
  const run = useActionToast();
  const confirm = useConfirm();
  const [log, setLog] = useState<OrderPayment[]>(booking.paymentLog);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft; fromSite: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const balance = orderBalance(booking.total, booking.currency, log);
  const money = (n: number) => fmtPrice(n, booking.currency);

  const done = (next: OrderPayment[]) => {
    setLog(next);
    setEditing(null);
    onChanged();
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const input = inputOf(editing.draft);
    const result = await run(
      () => (editing.id ? updateBookingPayment(editing.id, input) : addBookingPayment(booking.id, input)),
      editing.id ? "Payment updated" : "Payment recorded",
    );
    setBusy(false);
    if (result.success) done(result.data);
  };
  const remove = async (p: OrderPayment) => {
    const agreed = await confirm({
      title: "Remove this payment?",
      description: `${PAYMENT_KIND_LABELS[p.kind]} of ${fmtPrice(p.amount, p.currency)}. It leaves the order's balance; the change is kept in the log.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!agreed) return;
    setBusy(true);
    const result = await run(() => deleteBookingPayment(p.id), "Payment removed");
    setBusy(false);
    if (result.success) done(result.data);
  };
  const set = (patch: Partial<Draft>) => setEditing((e) => e && { ...e, draft: { ...e.draft, ...patch } });

  return (
    <div className="space-y-2 rounded-md border border-sky-500/25 bg-sky-500/5 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="h-4 w-4" /> Payments
        </h4>
        <span className="tabular text-xs text-muted-foreground">
          Total {money(balance.total)} · paid {money(balance.paid)}
          {balance.scheduled > 0 && ` · scheduled ${money(balance.scheduled)}`}
        </span>
        <BalanceChip booking={{ total: booking.total, currency: booking.currency, paymentLog: log }} />
        {balance.otherCurrency && <span className="text-xs text-amber-700 dark:text-amber-300">A payment in another currency is not in the balance.</span>}
        {!editing && (
          <Button size="sm" variant="outline" className="ms-auto" disabled={busy} onClick={() => setEditing({ id: null, draft: emptyDraft(balance.due), fromSite: false })}>
            <PlusCircle className="h-4 w-4" />
            Record a payment
          </Button>
        )}
      </div>

      {log.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-1.5 text-start font-medium">Name</th>
                <th className="px-2 py-1.5 text-start font-medium">Date</th>
                <th className="px-2 py-1.5 text-start font-medium">Time</th>
                <th className="px-2 py-1.5 text-start font-medium">Description</th>
                <th className="px-2 py-1.5 text-start font-medium">Status</th>
                <th className="px-2 py-1.5 text-end font-medium">Amount</th>
                <th className="px-2 py-1.5 text-start font-medium">Tax invoice</th>
                <th className="px-2 py-1.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {log.map((p) => {
                const local = p.paidAt ? isoToJerusalemLocal(p.paidAt) : "";
                return (
                  <tr key={p.id} className={cn("border-b last:border-b-0", p.status === "failed" && "text-muted-foreground line-through")}>
                    <td dir="auto" className="px-2 py-1.5">
                      {p.payerName || (p.enteredBy ? <span className="text-muted-foreground">by {p.enteredBy}</span> : "The site")}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular">
                      {p.status === "scheduled" ? (p.dueDate ? <span>due {fmtDate(p.dueDate)}</span> : EMPTY) : local ? fmtDate(local.slice(0, 10)) : EMPTY}
                    </td>
                    <td className="px-2 py-1.5 tabular text-muted-foreground">{p.status !== "scheduled" && knownTime(p.paidAt) ? local.slice(11, 16) : ""}</td>
                    <td className="px-2 py-1.5">
                      {PAYMENT_KIND_LABELS[p.kind]}
                      {p.method && <span className="block text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[p.method]}</span>}
                      {p.note && (
                        <span dir="auto" className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={p.note}>
                          {p.note}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-semibold",
                          p.status === "paid" && "bg-green-500/10 text-green-700 dark:text-green-300",
                          p.status === "scheduled" && "bg-amber-500/10 text-amber-800 dark:text-amber-300",
                          p.status === "failed" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-end tabular font-medium">
                      {p.kind === "refund" ? "−" : ""}
                      {fmtPrice(p.amount, p.currency)}
                      {p.amountIls != null && <span className="block text-xs font-normal text-muted-foreground">{fmtPrice(p.amountIls, "ILS")}</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">{p.invoiceNo || <span className="text-muted-foreground">pending</span>}</td>
                    <td className="whitespace-nowrap px-1 py-1 text-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={busy}
                        aria-label="Edit the payment"
                        onClick={() => setEditing({ id: p.id, draft: draftOf(p), fromSite: p.method === "site" })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {p.method !== "site" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          disabled={busy}
                          aria-label="Remove the payment"
                          onClick={() => void remove(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-md border bg-background p-3">
          {editing.fromSite ? (
            <>
              <p className="text-xs text-muted-foreground">A card payment from the site: add its tax invoice number or a note. To give money back, record a refund.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tax invoice No.">
                  <Input dir="ltr" value={editing.draft.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} />
                </Field>
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="What">
                <Select value={editing.draft.kind} onValueChange={(kind) => set({ kind })}>
                  <SelectTrigger aria-label="What the payment is">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {PAYMENT_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={editing.draft.status} onValueChange={(status) => set({ status })}>
                  <SelectTrigger aria-label="Paid or scheduled">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["paid", "scheduled", "failed"] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {PAYMENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={`Amount (${booking.currency})`}>
                <Input inputMode="decimal" dir="ltr" value={editing.draft.amount} onChange={(e) => set({ amount: e.target.value })} />
              </Field>
              {editing.draft.status === "scheduled" ? (
                <Field label="Due on">
                  <Input type="date" value={editing.draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
                </Field>
              ) : (
                <Field label="Paid on">
                  <Input type="date" value={editing.draft.paidOn} onChange={(e) => set({ paidOn: e.target.value })} />
                </Field>
              )}
              <Field label="How">
                <Select value={editing.draft.method || "none"} onValueChange={(method) => set({ method: method === "none" ? "" : method })}>
                  <SelectTrigger aria-label="How it was paid">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not said</SelectItem>
                    {STAFF_PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Paid in shekels (optional)">
                <Input inputMode="decimal" dir="ltr" value={editing.draft.amountIls} onChange={(e) => set({ amountIls: e.target.value })} />
              </Field>
              <Field label="Payer">
                <Input dir="auto" value={editing.draft.payerName} onChange={(e) => set({ payerName: e.target.value })} placeholder="Who paid" />
              </Field>
              <Field label="Tax invoice No.">
                <Input dir="ltr" value={editing.draft.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} />
              </Field>
            </div>
          )}
          <Field label="Note">
            <Textarea dir="auto" rows={2} maxLength={1000} value={editing.draft.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing.id ? "Save" : "Record"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** What cancelling the order costs today, by the tour's fee rules (Alon 20.10: "Overall | 400$"). */
export function CancelFeeToday({ rules, booking }: { rules: readonly CancellationRule[]; booking: BookingRow }) {
  if (!booking.departureStart) return null;
  const fee = cancellationFeeToday({
    rules,
    departureStart: booking.departureStart,
    today: todayIso(),
    travelers: booking.adults + booking.children,
    orderTotal: booking.total,
  });
  const money = (n: number) => fmtPrice(n, booking.currency);
  if (!fee) {
    return <p className="text-xs text-muted-foreground">No cancellation fees are set on this tour yet - the tour editor has them under Cancellation fees.</p>;
  }
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">
        Cancellation policy at the moment ({fee.daysLeft >= 0 ? `${fee.daysLeft} days before the departure` : "the departure left"}):
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {fee.lines.map((line) => (
          <span key={line.component}>
            <strong>{CANCEL_COMPONENT_LABELS[line.component]}:</strong>{" "}
            {line.rule ? (
              <>
                {money(line.fee ?? 0)}
                {line.rule.feeKind !== "per_order" && <span className="text-muted-foreground"> ({ruleFeeText(line.rule, money)})</span>}
                {line.until && <>, until {fmtDate(line.until)}</>}
                {line.next && <span className="text-muted-foreground">. Then {ruleFeeText(line.next, money)}</span>}
              </>
            ) : (
              <span className="text-amber-700 dark:text-amber-300">no rule covers today</span>
            )}
          </span>
        ))}
        <span className="rounded border border-red-500/40 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
          Overall {money(fee.total)}
          {fee.incomplete && " +"}
        </span>
      </div>
    </div>
  );
}
