"use client";

/**
 * Seats and deadlines of a flight block.
 *
 * Seats: one action, "עדכון מושבים" - the contract's wording and the nearest
 * deadline sit beside the form, so the operator sees whether a reduction costs money.
 * Deadlines: each one is edited in place; "חשב מחדש מהחוזה" writes only the
 * deadlines the operator ticks, so a hand-typed date is never lost by accident.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  recomputeTourBlockDeadlines,
  recordTourBlockDeposit,
  updateTourBlockDeadline,
  updateTourBlockSeats,
  type TourBlockData,
} from "@/lib/actions/tours-flight-actions";
import {
  CONTRACT_DEADLINE_FIELDS,
  DEADLINE_FIELDS,
  DEADLINE_LABELS,
  computeDeadlines,
  daysLeft,
  formatDateShort,
  toDateOnly,
  type ContractDeadlineField,
  type DeadlineField,
} from "@/lib/tours/deadlines";
import { CURRENCIES } from "@/types/tours.types";
import {
  DaysLeft,
  Field,
  Ltr,
  Notice,
  RtlDialogContent,
  RtlDialogFooter,
  RtlDialogHeader,
  Section,
  Stat,
  formatMoney,
  parseNumber,
  type RunAction,
} from "@/components/tours/flights/block-ui";

interface SectionProps {
  data: TourBlockData;
  run: RunAction;
}

/** The wording to show beside a seat change: the block's contract, else the company's source document. */
function termsOf(data: TourBlockData): { title: string; text: string } | null {
  if (data.contract?.terms_text?.trim()) return { title: `נוסח החוזה: ${data.contract.name}`, text: data.contract.terms_text };
  if (data.sourceTerms?.trim()) return { title: "תנאי ביטול והתחייבות (מסמך מקור)", text: data.sourceTerms };
  return null;
}

/** The nearest deadline that has not passed yet. */
function nextDeadline(data: TourBlockData): { field: DeadlineField; date: string; days: number } | null {
  let best: { field: DeadlineField; date: string; days: number } | null = null;
  for (const field of DEADLINE_FIELDS) {
    const date = toDateOnly(data.block[field]);
    const days = daysLeft(date, data.today);
    if (!date || days === null || days < 0) continue;
    if (!best || days < best.days) best = { field, date, days };
  }
  return best;
}

// ------------------------------------------------------------------ seats

export function BlockSeatsSection({ data, run }: SectionProps) {
  const { block } = data;
  const [open, setOpen] = useState(false);
  const original = block.original_quantity ?? block.initial_quantity;
  const free = block.initial_quantity - data.allocatedSeats;

  return (
    <Section
      title="מושבים"
      description="הכמות המקורית נשמרת בעדכון הראשון. כל שינוי נרשם בציר האירועים."
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          עדכון מושבים
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="הזמנה מקורית" value={original} tone={block.original_quantity === null ? "muted" : "default"} />
        <Stat label="נוכחי" value={block.initial_quantity} />
        <Stat label="משויך ליציאות" value={data.allocatedSeats} />
        <Stat label="פנוי לשיוך" value={free} tone={free < 0 ? "danger" : "default"} />
      </div>
      {free < 0 && (
        <div className="mt-2">
          <Notice tone="danger">שויכו יותר מושבים ממה שיש בבלוק. הקטינו שיוך או עדכנו את כמות המושבים.</Notice>
        </div>
      )}
      {open && <SeatsDialog data={data} run={run} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function SeatsDialog({ data, run, onClose }: SectionProps & { onClose: () => void }) {
  const { block } = data;
  const [quantity, setQuantity] = useState(String(block.initial_quantity));
  const [date, setDate] = useState(data.today);
  const [reason, setReason] = useState("");
  const [cleaned, setCleaned] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = parseNumber(quantity);
  const value = typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  const terms = termsOf(data);
  const next = nextDeadline(data);
  const reducing = value !== null && value < block.initial_quantity;

  let problem: string | null = null;
  if (value === null) problem = "הזינו מספר שלם, 0 ומעלה";
  else if (value === block.initial_quantity) problem = "זו כבר כמות המושבים של הבלוק";
  else if (value < data.allocatedSeats) problem = `${data.allocatedSeats} מושבים כבר משויכים ליציאות. הורידו שיוך קודם.`;
  else if (!reason.trim()) problem = "כתבו את הסיבה";

  const submit = async () => {
    if (value === null) return;
    setSaving(true);
    const ok = await run(
      () => updateTourBlockSeats(block.id, { quantity: value, date, reason, cleaned: reducing && cleaned }),
      `הבלוק עודכן ל-${value} מושבים`,
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RtlDialogContent className="sm:max-w-3xl">
        <RtlDialogHeader>
          <DialogTitle>עדכון מושבים</DialogTitle>
          <DialogDescription>
            היום בבלוק {block.initial_quantity} מושבים, מהם {data.allocatedSeats} משויכים ליציאות.
          </DialogDescription>
        </RtlDialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-4">
            <Field label="כמות חדשה" htmlFor="seats-quantity">
              <Input
                id="seats-quantity"
                dir="ltr"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="תאריך" htmlFor="seats-date">
              <Input id="seats-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="סיבה" htmlFor="seats-reason">
              <Textarea id="seats-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {reducing && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={cleaned} onCheckedChange={(c) => setCleaned(c === true)} />
                ניקוי מושבים (החזרת מושבים שלא נמכרו, לא הורדה יזומה)
              </label>
            )}
            {problem && <p className="text-sm text-destructive">{problem}</p>}
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 font-medium">המועד הקרוב</div>
              {next ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{DEADLINE_LABELS[next.field]}</span>
                  <Ltr>{formatDateShort(next.date)}</Ltr>
                  <DaysLeft days={next.days} />
                </div>
              ) : (
                <span className="text-muted-foreground">אין מועד עתידי בבלוק.</span>
              )}
              <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {(["first_cancellation_date", "last_cancellation_date"] as const).map((field) => (
                  <li key={field} className="flex flex-wrap items-center gap-2">
                    <span>{DEADLINE_LABELS[field]}:</span>
                    {block[field] ? <Ltr>{formatDateShort(block[field])}</Ltr> : null}
                    <DaysLeft days={daysLeft(block[field], data.today)} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 font-medium">{terms ? terms.title : "נוסח החוזה"}</div>
              {terms ? (
                <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [unicode-bidi:plaintext] text-right">
                  {terms.text}
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {data.contract ? "לחוזה של הבלוק לא הוזן נוסח." : "לבלוק אין חוזה."}
                </span>
              )}
            </div>
          </div>
        </div>

        <RtlDialogFooter>
          <Button onClick={submit} disabled={saving || problem !== null || !date}>
            {saving ? "שומר..." : "עדכון מושבים"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ deadlines

export function BlockDeadlinesSection({ data, run }: SectionProps) {
  const { block } = data;
  const [recomputeOpen, setRecomputeOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const namesSent = data.events.some((e) => e.kind === "names_sent");
  const ticketed = block.block_status === "ticketed" || data.events.some((e) => e.kind === "ticketed");
  const deposits = data.events.filter((e) => e.kind === "deposit_paid");
  const isDone = (field: DeadlineField) =>
    (field === "names_deadline" && namesSent) || (field === "ticketing_deadline" && ticketed);

  return (
    <Section
      title="מועדים"
      description="ארבעת הראשונים מחושבים מהחוזה בכניסה לסטטוס אושר. כל מועד ניתן לעריכה, ועריכה ידנית לא נדרסת."
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setRecomputeOpen(true)}>
            חשב מחדש מהחוזה
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDepositOpen(true)}>
            רישום מקדמה
          </Button>
        </>
      }
    >
      <ul className="divide-y">
        {DEADLINE_FIELDS.map((field) => (
          <DeadlineRow key={field} field={field} data={data} run={run} done={isDone(field)} />
        ))}
      </ul>

      <div className="mt-3 border-t pt-3 text-sm">
        <div className="mb-1 font-medium">מקדמות ששולמו</div>
        {deposits.length === 0 ? (
          <span className="text-muted-foreground">לא נרשמה מקדמה.</span>
        ) : (
          <ul className="grid gap-1">
            {deposits.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Ltr>{formatDateShort(d.happened_on)}</Ltr>
                <Ltr className="font-medium">{formatMoney(d.amount, d.currency)}</Ltr>
                {d.note && <span className="text-muted-foreground">{d.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {recomputeOpen && <RecomputeDialog data={data} run={run} onClose={() => setRecomputeOpen(false)} />}
      {depositOpen && <DepositDialog data={data} run={run} onClose={() => setDepositOpen(false)} />}
    </Section>
  );
}

function DeadlineRow({
  field,
  data,
  run,
  done,
}: SectionProps & { field: DeadlineField; done: boolean }) {
  const saved = toDateOnly(data.block[field]) ?? "";
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  // A reload (after any action) brings the stored value back into the field.
  useEffect(() => setValue(saved), [saved]);
  // An empty field next to a stored date is a half-typed date, not a request to clear ("נקה" does that).
  const dirty = value !== saved && value !== "";

  const commit = async (next: string) => {
    if (next === saved) return;
    setSaving(true);
    const ok = await run(
      () => updateTourBlockDeadline(data.block.id, field, next === "" ? null : next),
      `מועד ${DEADLINE_LABELS[field]} עודכן`,
    );
    setSaving(false);
    if (!ok) setValue(saved);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <label htmlFor={`deadline-${field}`} className="w-28 shrink-0 text-sm font-medium">
        {DEADLINE_LABELS[field]}
      </label>
      <Input
        id={`deadline-${field}`}
        type="date"
        className="h-8 w-40"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) void commit(value);
          if (e.key === "Escape") setValue(saved);
        }}
      />
      {dirty ? (
        // Saved on request only: a half-typed date reads as empty, and leaving the
        // field must never wipe a deadline.
        <>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={() => commit(value)}>
            {saving ? "שומר..." : "שמור"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={saving}
            onClick={() => setValue(saved)}
          >
            בטל
          </Button>
        </>
      ) : (
        <>
          <DaysLeft days={daysLeft(saved, data.today)} done={done && saved !== ""} />
          {saved !== "" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              disabled={saving}
              onClick={() => commit("")}
            >
              נקה
            </Button>
          )}
        </>
      )}
    </li>
  );
}

function RecomputeDialog({ data, run, onClose }: SectionProps & { onClose: () => void }) {
  const { block, contract } = data;
  const computed = computeDeadlines(block.outbound_departure_time, contract);
  // Ticked by default: only what the block does not have. Replacing a date is the operator's call.
  const [picked, setPicked] = useState<ContractDeadlineField[]>(
    CONTRACT_DEADLINE_FIELDS.filter((f) => computed[f] && !block[f]),
  );
  const [saving, setSaving] = useState(false);

  const toggle = (field: ContractDeadlineField, on: boolean) =>
    setPicked((current) => (on ? [...current, field] : current.filter((f) => f !== field)));

  const submit = async () => {
    setSaving(true);
    const ok = await run(() => recomputeTourBlockDeadlines(block.id, picked), "המועדים חושבו מהחוזה");
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RtlDialogContent className="sm:max-w-xl">
        <RtlDialogHeader>
          <DialogTitle>חישוב מועדים מהחוזה</DialogTitle>
          <DialogDescription>
            {contract
              ? `לפי "${contract.name}" ותאריך הטיסה. מתעדכנים רק המועדים שתסמנו.`
              : "לבלוק אין חוזה. בחרו חוזה בחלק \"חוזה\" ואז חשבו."}
          </DialogDescription>
        </RtlDialogHeader>

        {contract && (
          <ul className="divide-y rounded-md border">
            {CONTRACT_DEADLINE_FIELDS.map((field) => {
              const next = computed[field];
              const current = toDateOnly(block[field]);
              const same = !!next && next === current;
              return (
                <li key={field} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <Checkbox
                    id={`recompute-${field}`}
                    checked={picked.includes(field)}
                    disabled={!next || same}
                    onCheckedChange={(c) => toggle(field, c === true)}
                  />
                  <label htmlFor={`recompute-${field}`} className="w-24 font-medium">
                    {DEADLINE_LABELS[field]}
                  </label>
                  <span className="text-muted-foreground">
                    היום: {current ? <Ltr>{formatDateShort(current)}</Ltr> : "ריק"}
                  </span>
                  <span>
                    מהחוזה:{" "}
                    {next ? <Ltr className="font-medium">{formatDateShort(next)}</Ltr> : "אין ימים בחוזה"}
                  </span>
                  {same && <span className="text-xs text-muted-foreground">זהה</span>}
                  {next && current && !same && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">יחליף תאריך קיים</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <RtlDialogFooter>
          <Button onClick={submit} disabled={saving || !contract || picked.length === 0}>
            {saving ? "מחשב..." : "עדכון המועדים שסומנו"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}

const DEPOSIT_CURRENCIES = [...CURRENCIES, "ILS"];

function DepositDialog({ data, run, onClose }: SectionProps & { onClose: () => void }) {
  const { block } = data;
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(block.cost_currency ?? "USD");
  const [date, setDate] = useState(data.today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = parseNumber(amount);
  const valid = typeof parsed === "number" && parsed > 0;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const ok = await run(
      () => recordTourBlockDeposit(block.id, { amount: parsed, currency, date, note }),
      "המקדמה נרשמה",
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RtlDialogContent className="sm:max-w-md">
        <RtlDialogHeader>
          <DialogTitle>רישום מקדמה</DialogTitle>
          <DialogDescription>תשלום מקדמה לחברת התעופה נרשם כאירוע בציר האירועים של הבלוק.</DialogDescription>
        </RtlDialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="סכום" htmlFor="deposit-amount">
              <Input
                id="deposit-amount"
                dir="ltr"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="מטבע">
              <Select dir="rtl" value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPOSIT_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="תאריך התשלום" htmlFor="deposit-date">
            <Input id="deposit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="הערה (לא חובה)" htmlFor="deposit-note">
            <Input id="deposit-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <RtlDialogFooter>
          <Button onClick={submit} disabled={saving || !valid || !date}>
            {saving ? "שומר..." : "רישום המקדמה"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}
