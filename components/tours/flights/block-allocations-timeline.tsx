"use client";

/**
 * Allocations and timeline of a flight block.
 *
 * Allocations: the departures this block serves. A block may be split between
 * departures, and a departure may take only one direction of it. Both ends are
 * checked by city on the server before anything is written.
 * Timeline: flight_block_events, newest first - the lifecycle steps, seat changes,
 * deposits and the notes the operator adds.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-provider";
import {
  addTourBlockEvent,
  allocateTourBlock,
  listAllocatableDepartures,
  removeTourBlockAllocation,
  type AllocatableDeparture,
  type TourBlockAllocation,
  type TourBlockData,
} from "@/lib/actions/tours-flight-actions";
import { formatDateShort } from "@/lib/tours/deadlines";
import {
  ALLOCATION_LEGS,
  ALLOCATION_LEGS_LABELS,
  stageOf,
  type AllocationLegs,
} from "@/components/tours/flights/block-rules";
import { BLOCK_EVENT_LABELS, type BlockEventKind } from "@/types/tours.types";
import {
  Field,
  Ltr,
  Notice,
  RtlDialogContent,
  RtlDialogFooter,
  RtlDialogHeader,
  Section,
  formatMoney,
  parseNumber,
  type RunAction,
} from "@/components/tours/flights/block-ui";

interface SectionProps {
  data: TourBlockData;
  run: RunAction;
}

const departureHref = (code: string) => `/tours/departures?code=${encodeURIComponent(code)}`;

// ------------------------------------------------------------------ allocations

export function BlockAllocationsSection({ data, run }: SectionProps) {
  const { block, allocations } = data;
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const stage = stageOf(block.block_status);
  const closed = stage === "cancelled" || stage === "declined";
  const free = block.initial_quantity - data.allocatedSeats;

  const remove = async (allocation: TourBlockAllocation) => {
    const ok = await confirm({
      title: "להסיר את השיוך?",
      description: `${allocation.seats} מושבים יחזרו למאגר, והיציאה ${allocation.code} תישאר בלי הבלוק הזה.`,
      confirmLabel: "הסרת השיוך",
      cancelLabel: "חזרה",
      destructive: true,
    });
    if (!ok) return;
    setRemoving(allocation.id);
    await run(() => removeTourBlockAllocation(block.id, allocation.id), "השיוך הוסר");
    setRemoving(null);
  };

  return (
    <Section
      title="שיוך ליציאות"
      description="היציאות שהבלוק משרת. בלוק בלי שיוך נשאר במאגר."
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={closed}>
          שיוך ליציאה
        </Button>
      }
    >
      {allocations.length === 0 ? (
        <Notice>
          {closed ? "הבלוק לא משויך לאף יציאה." : `הבלוק במאגר: ${free} מושבים פנויים לשיוך.`}
        </Notice>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>יציאה</TableHead>
              <TableHead>תאריכים</TableHead>
              <TableHead>מסלול</TableHead>
              <TableHead>מושבים</TableHead>
              <TableHead>כיוון</TableHead>
              <TableHead>בדיקה</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link href={departureHref(a.code)} className="font-medium text-primary underline-offset-4 hover:underline">
                    <Ltr>{a.code}</Ltr>
                  </Link>
                  {!a.is_published && <span className="ms-2 text-xs text-muted-foreground">לא מפורסם</span>}
                </TableCell>
                <TableCell>
                  <Ltr>
                    {formatDateShort(a.start_date)} - {formatDateShort(a.end_date)}
                  </Ltr>
                </TableCell>
                <TableCell>
                  <Ltr>{a.route || "-"}</Ltr>
                </TableCell>
                <TableCell className="tabular-nums">{a.seats}</TableCell>
                <TableCell>{ALLOCATION_LEGS_LABELS[a.legs]}</TableCell>
                <TableCell className="text-xs">
                  {!a.fits ? (
                    <span className="font-medium text-destructive">{a.fitReason}</span>
                  ) : a.dayGap !== 0 ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      הפרש של {Math.abs(a.dayGap) === 1 ? "יום" : `${Math.abs(a.dayGap)} ימים`} מהטיסה
                    </span>
                  ) : (
                    <span className="text-muted-foreground">תואם</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={removing === a.id}
                    onClick={() => remove(a)}
                  >
                    הסרה
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {open && <AllocateDialog data={data} run={run} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function AllocateDialog({ data, run, onClose }: SectionProps & { onClose: () => void }) {
  const { block } = data;
  const free = Math.max(0, block.initial_quantity - data.allocatedSeats);
  const [candidates, setCandidates] = useState<AllocatableDeparture[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [departureId, setDepartureId] = useState("");
  const [legs, setLegs] = useState<AllocationLegs>("both");
  const [seats, setSeats] = useState(String(free || ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAllocatableDepartures(block.id)
      .then((res) => {
        if (cancelled) return;
        if (res.success) setCandidates(res.data);
        else setLoadError(res.error);
      })
      .catch(() => !cancelled && setLoadError("טעינת היציאות נכשלה"));
    return () => {
      cancelled = true;
    };
  }, [block.id]);

  const chosen = candidates?.find((c) => c.id === departureId) ?? null;
  const fit = chosen ? chosen.fit[legs] : null;
  const parsed = parseNumber(seats);
  const seatsValue = typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  const existing = data.allocations.find((a) => a.departure_id === departureId && a.legs === legs) ?? null;

  const submit = async () => {
    if (!chosen || seatsValue === null) return;
    setSaving(true);
    const ok = await run(
      () => allocateTourBlock(block.id, { departureId: chosen.id, seats: seatsValue, legs }),
      existing ? `השיוך ל-${chosen.code} עודכן` : `הבלוק שויך ל-${chosen.code}`,
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RtlDialogContent className="sm:max-w-lg">
        <RtlDialogHeader>
          <DialogTitle>שיוך ליציאה</DialogTitle>
          <DialogDescription>
            מוצגות יציאות שמתחילות עד יומיים מתאריך הטיסה. המסלול נבדק בשני הקצוות לפי עיר.
          </DialogDescription>
        </RtlDialogHeader>

        {loadError ? (
          <Notice tone="danger">{loadError}</Notice>
        ) : candidates === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען יציאות...
          </div>
        ) : candidates.length === 0 ? (
          <Notice>אין יציאה של החברה בטווח של יומיים מתאריכי הטיסה.</Notice>
        ) : (
          <div className="grid gap-4">
            <Field label="יציאה">
              <Select dir="rtl" value={departureId} onValueChange={setDepartureId}>
                <SelectTrigger>
                  <SelectValue placeholder="בחרו יציאה" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span dir="ltr">
                        {c.code} · {formatDateShort(c.start_date)} - {formatDateShort(c.end_date)}
                        {c.route ? ` · ${c.route}` : ""}
                      </span>
                      {c.fit.both.ok ? "" : " · לא תואם"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="כיוון">
                <Select dir="rtl" value={legs} onValueChange={(v) => setLegs(v as AllocationLegs)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLOCATION_LEGS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {ALLOCATION_LEGS_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="מושבים" htmlFor="allocate-seats" hint={`פנויים בבלוק: ${free}`}>
                <Input
                  id="allocate-seats"
                  dir="ltr"
                  inputMode="numeric"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                />
              </Field>
            </div>
            {chosen && (
              <div className="grid gap-2 text-sm">
                <div className="text-muted-foreground">
                  ליציאה {chosen.code} משויכים היום {chosen.allocated_seats} מושבים חיים, נמכרו {chosen.sold}.
                </div>
                {fit && !fit.ok && <Notice tone="danger">{fit.reason}</Notice>}
                {existing && (
                  <Notice tone="warning">
                    כבר קיים שיוך כזה של {existing.seats} מושבים. השמירה תעדכן את הכמות.
                  </Notice>
                )}
              </div>
            )}
          </div>
        )}

        <RtlDialogFooter>
          <Button onClick={submit} disabled={saving || !chosen || seatsValue === null || (fit !== null && !fit.ok)}>
            {saving ? "שומר..." : existing ? "עדכון השיוך" : "שיוך"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ timeline

/** What an operator may add by hand; the other kinds are written by the actions of the panel. */
const MANUAL_KINDS: BlockEventKind[] = ["note", "quoted", "names_sent", "schedule_change"];

const eventLabel = (kind: string): string =>
  kind in BLOCK_EVENT_LABELS ? BLOCK_EVENT_LABELS[kind as BlockEventKind] : kind;

export function BlockTimelineSection({ data, run }: SectionProps) {
  const { block, events } = data;
  const [kind, setKind] = useState<BlockEventKind>("note");
  const [date, setDate] = useState(data.today);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const withAmount = kind === "quoted";
  const parsedAmount = withAmount ? parseNumber(amount) : null;
  const canSave = !!date && parsedAmount !== undefined && (kind !== "note" || note.trim() !== "");

  const add = async () => {
    if (!canSave) return;
    setSaving(true);
    const ok = await run(
      () =>
        addTourBlockEvent(block.id, {
          kind,
          note,
          date,
          amount: parsedAmount ?? null,
          currency: parsedAmount === null || parsedAmount === undefined ? null : (block.cost_currency ?? "USD"),
        }),
      "נרשם בציר האירועים",
    );
    setSaving(false);
    if (ok) {
      setNote("");
      setAmount("");
      setKind("note");
    }
  };

  return (
    <Section title="ציר אירועים" description="כל מה שקרה לבלוק, מהחדש לישן.">
      <div className="grid gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-[10rem_10rem_1fr_auto] md:items-end">
        <Field label="סוג">
          <Select dir="rtl" value={kind} onValueChange={(v) => setKind(v as BlockEventKind)}>
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {BLOCK_EVENT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="תאריך" htmlFor="event-date">
          <Input
            id="event-date"
            type="date"
            className="bg-background"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label={kind === "note" ? "הערה" : "הערה (לא חובה)"} htmlFor="event-note">
            <Textarea
              id="event-note"
              rows={1}
              className="min-h-10 bg-background"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {withAmount && (
            <Field label={`מחיר שהוצע${block.cost_currency ? ` (${block.cost_currency})` : ""}`} htmlFor="event-amount">
              <Input
                id="event-amount"
                dir="ltr"
                inputMode="decimal"
                className="w-32 bg-background"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          )}
        </div>
        <Button onClick={add} disabled={saving || !canSave}>
          {saving ? "שומר..." : "הוספה"}
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="mt-3">
          <Notice>עוד לא נרשם אירוע לבלוק הזה.</Notice>
        </div>
      ) : (
        <ol className="mt-3 divide-y">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <Ltr className="w-16 shrink-0 text-muted-foreground">{formatDateShort(e.happened_on)}</Ltr>
              <span className="font-medium">{eventLabel(e.kind)}</span>
              {e.seats_after !== null && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">{e.seats_after} מושבים</span>
              )}
              {e.amount !== null && <Ltr className="font-medium">{formatMoney(e.amount, e.currency)}</Ltr>}
              {e.note && (
                <span className="min-w-0 break-words" dir="auto">
                  {e.note}
                </span>
              )}
              <span className="ms-auto text-xs text-muted-foreground">
                {e.created_by_name ?? (e.created_by ? "משתמש" : "מהטעינה")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
