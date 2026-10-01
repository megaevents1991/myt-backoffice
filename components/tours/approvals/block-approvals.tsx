"use client";

/**
 * Section 1 of the approvals screen: flight blocks that wait for a step only a
 * manager takes (functional spec 4.1).
 *   - a draft waits for the approval to order its dates;
 *   - a confirmed block whose cancellation date is close waits for "keep or cancel";
 *   - an upcoming live block waits for the manager's "נבדק" mark.
 * Every button runs the same lifecycle action the block card runs, so the
 * timeline and the audit trail read the same whichever screen was used.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { setTourBlockReviewed, transitionTourBlock } from "@/lib/actions/tours-flight-actions";
import {
  keepTourBlock,
  markTourBlocksReviewed,
  type ApprovalBlock,
  type ApprovalsData,
} from "@/lib/actions/tours-approvals-actions";
import { DEADLINE_LABELS, formatDateShort } from "@/lib/tours/deadlines";
import {
  CANCELLED_BY,
  CANCELLED_BY_LABELS,
  TRANSITION_ACTION_LABELS,
  type CancelledBy,
} from "@/components/tours/flights/block-rules";
import {
  BlockStatusBadge,
  DaysLeft,
  Field,
  Ltr,
  Notice,
  RtlDialogContent,
  RtlDialogFooter,
  RtlDialogHeader,
  formatMoney,
  formatNumber,
  parseNumber,
} from "@/components/tours/flights/block-ui";
import {
  ActionButton,
  QueueSection,
  SubList,
  blockHref,
  inDays,
  linkClass,
  type QueueControls,
} from "./queue-ui";

interface BlockApprovalsProps extends QueueControls {
  data: ApprovalsData;
  onReviewPage: (page: number) => void;
}

export function BlockApprovals({ data, run, busy, onReviewPage }: BlockApprovalsProps) {
  const { awaitingApproval, cancelDecisions, review } = data;
  const count = awaitingApproval.total + cancelDecisions.total + review.total;
  const [cancelTarget, setCancelTarget] = useState<ApprovalBlock | null>(null);

  return (
    <QueueSection
      id="blocks"
      title="אישורי מנהל לקבוצות טיסה"
      count={count}
      description="שלושה דברים בקבוצת טיסה שמורים למנהל החברה: אישור להזמנת התאריכים, ביטול של קבוצה שכבר אושרה בחברת התעופה, וסימון השורה כנבדקה. כל פעולה כאן נרשמת בקבוצה עצמה, עם השם והתאריך."
    >
      <SubList
        title="טיוטות שמחכות לאישור הזמנה"
        count={awaitingApproval.total}
        emptyText="אין טיוטות שמחכות לאישור"
        hint="קבוצות שהוכנו ועוד לא אושרו. אחרי האישור התפעול פונה לחברת התעופה."
      >
        <BlockTable
          rows={awaitingApproval.rows}
          today={data.today}
          actions={(block) => (
            <ActionButton
              actionKey={`approve:${block.id}`}
              busy={busy}
              disabled={block.seats <= 0}
              title={block.seats <= 0 ? "אי אפשר לאשר להזמנה קבוצה בלי כמות מושבים" : undefined}
              onClick={() =>
                void run(
                  `approve:${block.id}`,
                  () => transitionTourBlock(block.id, "approved", {}),
                  "הקבוצה אושרה להזמנה",
                )
              }
            >
              {TRANSITION_ACTION_LABELS.approved}
            </ActionButton>
          )}
        />
        <CutNote shown={awaitingApproval.rows.length} total={awaitingApproval.total} />
      </SubList>

      <SubList
        title="להחליט לפני מועד הביטול"
        count={cancelDecisions.total}
        emptyText={`אין קבוצה שמועד הביטול שלה ב-${data.decisionWindowDays} הימים הקרובים`}
        hint={`קבוצות מאושרות שמועד הביטול הראשון או האחרון שלהן ב-${data.decisionWindowDays} הימים הקרובים. "משאירים" רושם את ההחלטה בקבוצה ומסמן אותה כנבדקה; אחרי המועד אי אפשר להחזיר מושבים בלי דמי ביטול.`}
      >
        <BlockTable
          rows={cancelDecisions.rows}
          today={data.today}
          actions={(block) => (
            <>
              <ActionButton
                actionKey={`keep:${block.id}`}
                busy={busy}
                onClick={() =>
                  void run(`keep:${block.id}`, () => keepTourBlock(block.id), "ההחלטה נרשמה והקבוצה סומנה כנבדקה")
                }
              >
                משאירים
              </ActionButton>
              <ActionButton
                actionKey={`cancel:${block.id}`}
                busy={busy}
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setCancelTarget(block)}
              >
                ביטול הקבוצה
              </ActionButton>
            </>
          )}
        />
        <CutNote shown={cancelDecisions.rows.length} total={cancelDecisions.total} />
      </SubList>

      <ReviewList data={data} run={run} busy={busy} onReviewPage={onReviewPage} />

      {cancelTarget && (
        <CancelBlockDialog
          key={cancelTarget.id}
          block={cancelTarget}
          today={data.today}
          run={run}
          busy={busy}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </QueueSection>
  );
}

/** Said under a list that shows only its first rows. */
function CutNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="px-4 pb-3 text-xs text-muted-foreground">
      מוצגות {shown} הראשונות מתוך {total.toLocaleString("he-IL")}. השאר יופיעו כשאלה יטופלו, והרשימה המלאה ב
      <Link href="/offline-flights" className={linkClass}>
        קבוצות הטיסה
      </Link>
      .
    </p>
  );
}

// ------------------------------------------------------------------ review list

function ReviewList({ data, run, busy, onReviewPage }: BlockApprovalsProps) {
  const { review } = data;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const pageIds = useMemo(() => review.rows.map((r) => r.id), [review.rows]);

  // A row that left the page (handled, or another page) cannot stay selected.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => pageIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pageIds]);

  const pages = Math.max(1, Math.ceil(review.total / review.pageSize));
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;
  const first = (review.page - 1) * review.pageSize + 1;
  const last = first + review.rows.length - 1;

  const toggle = (id: number, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const markSelected = async () => {
    const ids = pageIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    await run(
      "review:bulk",
      () => markTourBlocksReviewed(ids),
      ids.length === 1 ? "השורה סומנה כנבדקה" : `${ids.length} שורות סומנו כנבדקות`,
    );
  };

  return (
    <SubList
      title="קבוצות חיות שעוד לא נבדקו"
      count={review.total}
      emptyText="כל הקבוצות החיות שעוד לא טסו נבדקו"
      hint={
        <>
          קבוצות שאושרו בחברת התעופה ועוד לא טסו, שמנהל עוד לא סימן כנבדקות. הקרובות למועד שלהן ראשונות.
          {data.otherUnreviewed > 0 && (
            <>
              {" "}
              עוד {data.otherUnreviewed.toLocaleString("he-IL")} שורות בלי סימון שייכות לקבוצות שכבר טסו, בוטלו, נדחו
              או עוד לא אושרו, והן לא מחכות כאן (
              <Link href="/offline-flights" className={linkClass}>
                לכל קבוצות הטיסה
              </Link>
              ).
            </>
          )}
        </>
      }
      actions={
        <ActionButton
          actionKey="review:bulk"
          busy={busy}
          disabled={selected.size === 0}
          onClick={() => void markSelected()}
        >
          {selected.size > 0 ? `סמן ${selected.size} כנבדק` : "סמן כנבדק"}
        </ActionButton>
      }
    >
      <BlockTable
        rows={review.rows}
        today={data.today}
        selection={{
          selected,
          allSelected,
          someSelected,
          onToggle: toggle,
          onToggleAll: (checked) => setSelected(checked ? new Set(pageIds) : new Set()),
          disabled: busy !== null,
        }}
        actions={(block) => (
          <ActionButton
            actionKey={`review:${block.id}`}
            busy={busy}
            variant="outline"
            onClick={() =>
              void run(`review:${block.id}`, () => setTourBlockReviewed(block.id, true), "השורה סומנה כנבדקה")
            }
          >
            נבדק
          </ActionButton>
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          שורות {first.toLocaleString("he-IL")}-{last.toLocaleString("he-IL")} מתוך {review.total.toLocaleString("he-IL")}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={review.page <= 1 || busy !== null}
              onClick={() => onReviewPage(review.page - 1)}
            >
              <ChevronRight aria-hidden />
              הקודם
            </Button>
            <span className="tabular-nums">
              עמוד {review.page} מתוך {pages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={review.page >= pages || busy !== null}
              onClick={() => onReviewPage(review.page + 1)}
            >
              הבא
              <ChevronLeft aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </SubList>
  );
}

// ------------------------------------------------------------------ the table

interface Selection {
  selected: Set<number>;
  allSelected: boolean;
  someSelected: boolean;
  onToggle: (id: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  disabled: boolean;
}

const cell = "px-3 py-2 align-top";
const sub = "mt-0.5 text-xs text-muted-foreground";

/** Rows of flight blocks with what a manager decides by: who flies, where, when, how many seats, at what cost, and the closest date. */
function BlockTable({
  rows,
  today,
  actions,
  selection,
}: {
  rows: ApprovalBlock[];
  today: string;
  actions: (block: ApprovalBlock) => ReactNode;
  selection?: Selection;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {selection && (
            <TableHead className="w-10 px-3">
              <Checkbox
                aria-label="בחירת כל השורות בעמוד"
                checked={selection.allSelected ? true : selection.someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => selection.onToggleAll(v === true)}
                disabled={selection.disabled}
              />
            </TableHead>
          )}
          <TableHead className="h-9 px-3 text-xs">קבוצה</TableHead>
          <TableHead className="h-9 px-3 text-xs">מסלול וטיסות</TableHead>
          <TableHead className="h-9 px-3 text-xs">תאריכים</TableHead>
          <TableHead className="h-9 px-3 text-xs">מושבים</TableHead>
          <TableHead className="h-9 px-3 text-xs">עלות למושב</TableHead>
          <TableHead className="h-9 px-3 text-xs">המועד הקרוב</TableHead>
          <TableHead className="h-9 px-3 text-xs">
            <span className="sr-only">פעולות</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((block) => (
          <BlockRow
            key={block.id}
            block={block}
            today={today}
            actions={actions(block)}
            selection={selection}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function BlockRow({
  block,
  today,
  actions,
  selection,
}: {
  block: ApprovalBlock;
  today: string;
  actions: ReactNode;
  selection?: Selection;
}) {
  const name = block.seriesName ?? block.seasonLabel ?? `קבוצה ${block.id}`;
  const airlines = block.inboundAirline ? `${block.airline} / ${block.inboundAirline}` : block.airline;
  const flights = [block.outboundFlight, block.inboundFlight].filter(Boolean).join(" · ");
  const deadline = block.cancelDecision
    ? {
        label: block.cancelDecision.kind === "first" ? DEADLINE_LABELS.first_cancellation_date : DEADLINE_LABELS.last_cancellation_date,
        date: block.cancelDecision.date,
        daysLeft: block.cancelDecision.daysLeft,
      }
    : block.nearestDeadline;
  const flyIn = daysUntil(today, block.outboundDate);

  return (
    <TableRow data-block-id={block.id} data-state={selection?.selected.has(block.id) ? "selected" : undefined}>
      {selection && (
        <TableCell className={`${cell} w-10`}>
          <Checkbox
            aria-label={`בחירת ${name}`}
            checked={selection.selected.has(block.id)}
            onCheckedChange={(v) => selection.onToggle(block.id, v === true)}
            disabled={selection.disabled}
          />
        </TableCell>
      )}
      <TableCell className={cell}>
        <Link href={blockHref(block.id)} className={linkClass} title="פתיחת כרטיס הקבוצה">
          <span dir="auto">{name}</span>
        </Link>
        <div className={`${sub} flex flex-wrap items-center gap-x-2 gap-y-1`}>
          <Ltr className="font-medium text-foreground/80">{airlines}</Ltr>
          {block.pnr && (
            <span>
              PNR <Ltr>{block.pnr}</Ltr>
            </span>
          )}
          {block.status !== null && block.status !== "confirmed" && <BlockStatusBadge status={block.status} />}
          {!block.hasContract && block.status !== null && <span className="text-amber-700 dark:text-amber-400">בלי חוזה</span>}
        </div>
      </TableCell>
      <TableCell className={cell}>
        <Ltr className="font-medium">{block.route}</Ltr>
        {flights && (
          <div className={sub}>
            <Ltr>{flights}</Ltr>
          </div>
        )}
      </TableCell>
      <TableCell className={`${cell} whitespace-nowrap`}>
        <Ltr>
          {formatDateShort(block.outboundDate)} - {formatDateShort(block.inboundDate)}
        </Ltr>
        {flyIn !== null && <div className={sub}>טסים {inDays(flyIn)}</div>}
      </TableCell>
      <TableCell className={cell}>
        <span className="font-medium tabular-nums">{block.seats}</span>
        {block.originalSeats !== null && (
          <span className="text-xs text-muted-foreground"> מתוך {block.originalSeats} במקור</span>
        )}
        <div className={sub}>
          {block.allocated > 0 ? (
            <>
              משויכים {block.allocated}
              {block.allocatedTo.length > 0 && (
                <>
                  : <Ltr>{block.allocatedTo.join(", ")}</Ltr>
                </>
              )}
            </>
          ) : (
            "לא משויכת ליציאה"
          )}
        </div>
      </TableCell>
      <TableCell className={`${cell} whitespace-nowrap`}>
        {block.costPrice === null ? (
          <span className="text-muted-foreground">לא הוזנה</span>
        ) : (
          <>
            <Ltr className="font-medium">{formatMoney(block.costPrice, block.costCurrency)}</Ltr>
            {block.costTax !== null && block.costTax > 0 && (
              <div className={sub}>
                ועוד מס <Ltr>{formatNumber(block.costTax)}</Ltr>
              </div>
            )}
          </>
        )}
      </TableCell>
      <TableCell className={`${cell} whitespace-nowrap`}>
        {deadline ? (
          <>
            <span>{deadline.label}</span> <Ltr>{formatDateShort(deadline.date)}</Ltr>
            <div className="mt-0.5">
              <DaysLeft days={deadline.daysLeft} />
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">אין מועד פתוח</span>
        )}
      </TableCell>
      <TableCell className={cell}>
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </TableCell>
    </TableRow>
  );
}

/** Whole days from `today` to `date`, both `yyyy-mm-dd`; null when a date is missing. */
function daysUntil(today: string, date: string): number | null {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

// ------------------------------------------------------------------ cancel

/** What the lifecycle asks for when a confirmed block is cancelled: who, when, why and the fee. */
function CancelBlockDialog({
  block,
  today,
  run,
  busy,
  onClose,
}: QueueControls & { block: ApprovalBlock; today: string; onClose: () => void }) {
  const [cancelledBy, setCancelledBy] = useState<CancelledBy | "">("");
  const [date, setDate] = useState(today);
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");

  const feeValue = parseNumber(fee);
  const problem = !cancelledBy
    ? "ביטול דורש לציין מי ביטל: חברת התעופה או אנחנו"
    : !note.trim()
      ? "ביטול דורש סיבה"
      : feeValue === undefined || (feeValue !== null && feeValue < 0)
        ? "דמי הביטול חייבים להיות מספר חיובי"
        : !date
          ? "חסר תאריך"
          : null;
  const name = block.seriesName ?? block.seasonLabel ?? `קבוצה ${block.id}`;
  const saving = busy === `cancel:${block.id}`;

  const submit = async () => {
    if (problem || !cancelledBy) return;
    const ok = await run(
      `cancel:${block.id}`,
      () => transitionTourBlock(block.id, "cancelled", { date, note, cancelledBy, fee: feeValue ?? null }),
      "הקבוצה בוטלה",
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <RtlDialogContent className="sm:max-w-lg">
        <RtlDialogHeader>
          <DialogTitle>ביטול הקבוצה</DialogTitle>
          <DialogDescription>
            הקבוצה תעבור לסטטוס &quot;בוטל&quot;. הביטול נרשם בציר האירועים שלה, ואי אפשר לחזור ממנו.
          </DialogDescription>
        </RtlDialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium" dir="auto">
              {name}
            </span>
            <Ltr>{block.route}</Ltr>
            <Ltr className="text-muted-foreground">
              {formatDateShort(block.outboundDate)} - {formatDateShort(block.inboundDate)}
            </Ltr>
            <span className="text-muted-foreground">{block.seats} מושבים</span>
          </div>
          {block.allocatedTo.length > 0 && (
            <Notice tone="warning">
              {block.allocatedTo.length === 1 ? "יציאה אחת נשענת" : `${block.allocatedTo.length} יציאות נשענות`} על
              הקבוצה הזו ויישארו בלי טיסה חיה: <Ltr>{block.allocatedTo.join(", ")}</Ltr>
            </Notice>
          )}
          <Field label="מי ביטל">
            <Select dir="rtl" value={cancelledBy} onValueChange={(v) => setCancelledBy(v as CancelledBy)}>
              <SelectTrigger>
                <SelectValue placeholder="בחרו" />
              </SelectTrigger>
              <SelectContent>
                {CANCELLED_BY.map((who) => (
                  <SelectItem key={who} value={who}>
                    {CANCELLED_BY_LABELS[who]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={`דמי ביטול ששולמו${block.costCurrency ? ` (${block.costCurrency})` : ""}`}
            htmlFor="approvals-cancel-fee"
            hint="להשאיר ריק אם לא שולמו."
          >
            <Input
              id="approvals-cancel-fee"
              dir="ltr"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </Field>
          <Field label="תאריך" htmlFor="approvals-cancel-date">
            <Input id="approvals-cancel-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="סיבה" htmlFor="approvals-cancel-note">
            <Textarea id="approvals-cancel-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {problem && <p className="text-sm text-muted-foreground">{problem}</p>}
        </div>

        <RtlDialogFooter>
          <Button type="button" variant="destructive" onClick={() => void submit()} disabled={!!problem || busy !== null}>
            {saving ? "מבטל..." : "ביטול הקבוצה"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}
