"use client";

/**
 * Section 1 of the approvals screen: flight blocks that wait for a step only a
 * manager takes (functional spec 4.1).
 *   - a draft waits for the approval to order its dates;
 *   - a confirmed block whose cancellation date is close waits for "keep or cancel";
 *   - an upcoming live block waits for the manager's "Reviewed" mark.
 * Every button runs the same lifecycle action the block card runs, so the
 * timeline and the audit trail read the same whichever screen was used.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { DEADLINE_LABELS } from "@/lib/tours/deadlines";
import { daysLeft, fmtPrice, formatDateShort, formatNumber, parseNumber } from "@/lib/tours/format";
import { blockHref, linkClass } from "@/lib/tours/links";
import {
  CANCELLED_BY,
  CANCELLED_BY_LABELS,
  TRANSITION_ACTION_LABELS,
  type CancelledBy,
} from "@/components/tours/flights/block-rules";
import { Field, Ltr, Notice } from "@/components/tours/ui";
import { BlockStatusBadge, DaysLeft, daysLeftText } from "@/components/tours/flights/block-ui";
import { ActionButton, QueueSection, SubList, type QueueControls } from "./queue-ui";

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
      title="Flight block approvals"
      count={count}
      description="Three steps on a flight block are for the company manager only: approving its dates to book, cancelling a flight block the airline already confirmed, and marking it Reviewed. Every action here is recorded on the flight block itself, with the name and date."
    >
      <SubList
        title="Drafts waiting for approval to book"
        count={awaitingApproval.total}
        emptyText="No drafts waiting for approval"
        hint="Flight blocks that were prepared and not approved yet. Once approved, operations contacts the airline."
      >
        <BlockTable
          rows={awaitingApproval.rows}
          today={data.today}
          actions={(block) => (
            <ActionButton
              actionKey={`approve:${block.id}`}
              busy={busy}
              disabled={block.seats <= 0}
              title={block.seats <= 0 ? "A flight block with no seats can't be approved to book" : undefined}
              onClick={() =>
                void run(
                  `approve:${block.id}`,
                  () => transitionTourBlock(block.id, "approved", {}),
                  "Flight block approved to book",
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
        title="Decide before the cancellation date"
        count={cancelDecisions.total}
        emptyText={`No flight block has a cancellation date in the next ${data.decisionWindowDays} days`}
        hint={`Confirmed flight blocks whose first or last cancellation date falls in the next ${data.decisionWindowDays} days. "Keep" records the decision on the flight block and marks it Reviewed; after the date, seats can't be given back without a cancellation fee.`}
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
                  void run(`keep:${block.id}`, () => keepTourBlock(block.id), "Decision recorded and flight block marked Reviewed")
                }
              >
                Keep
              </ActionButton>
              <ActionButton
                actionKey={`cancel:${block.id}`}
                busy={busy}
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setCancelTarget(block)}
              >
                Cancel Flight Block
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
      Showing the first {shown} of {formatNumber(total)}. The rest appear as these are handled; the full list
      is in{" "}
      <Link href="/offline-flights" className={linkClass}>
        Offline Flights
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
      ids.length === 1 ? "Row marked Reviewed" : `${ids.length} rows marked Reviewed`,
    );
  };

  return (
    <SubList
      title="Live flight blocks not reviewed yet"
      count={review.total}
      emptyText="Every live flight block that has not flown yet is reviewed"
      hint={
        <>
          Flight blocks confirmed by the airline that have not flown yet and no manager has marked Reviewed. Soonest first.
          {data.otherUnreviewed > 0 && (
            <>
              {" "}
              Another {formatNumber(data.otherUnreviewed)} unmarked rows belong to flight blocks that already
              flew, were cancelled or declined, or are not confirmed yet, so they do not wait here (
              <Link href="/offline-flights" className={linkClass}>
                all flight blocks
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
          {selected.size > 0 ? `Mark ${selected.size} Reviewed` : "Mark Reviewed"}
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
              void run(`review:${block.id}`, () => setTourBlockReviewed(block.id, true), "Row marked Reviewed")
            }
          >
            Mark Reviewed
          </ActionButton>
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          Rows {formatNumber(first)}-{formatNumber(last)} of {formatNumber(review.total)}
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
              <ChevronLeft aria-hidden />
              Previous
            </Button>
            <span className="tabular-nums">
              Page {review.page} of {pages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={review.page >= pages || busy !== null}
              onClick={() => onReviewPage(review.page + 1)}
            >
              Next
              <ChevronRight aria-hidden />
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
    <Table look="list">
      <TableHeader>
        <TableRow>
          {selection && (
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all rows on this page"
                checked={selection.allSelected ? true : selection.someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => selection.onToggleAll(v === true)}
                disabled={selection.disabled}
              />
            </TableHead>
          )}
          <TableHead>Flight Block</TableHead>
          <TableHead>Route & Flights</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Seats</TableHead>
          <TableHead>Cost per Seat</TableHead>
          <TableHead>Next Deadline</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
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
  const name = block.seriesName ?? block.seasonLabel ?? `Flight block ${block.id}`;
  const airlines = block.inboundAirline ? `${block.airline} / ${block.inboundAirline}` : block.airline;
  const flights = [block.outboundFlight, block.inboundFlight].filter(Boolean).join(" · ");
  const deadline = block.cancelDecision
    ? {
        label: block.cancelDecision.kind === "first" ? DEADLINE_LABELS.first_cancellation_date : DEADLINE_LABELS.last_cancellation_date,
        date: block.cancelDecision.date,
        daysLeft: block.cancelDecision.daysLeft,
      }
    : block.nearestDeadline;
  const flyIn = daysLeft(block.outboundDate, today);

  return (
    <TableRow data-block-id={block.id} data-state={selection?.selected.has(block.id) ? "selected" : undefined}>
      {selection && (
        <TableCell className="w-10">
          <Checkbox
            aria-label={`Select ${name}`}
            checked={selection.selected.has(block.id)}
            onCheckedChange={(v) => selection.onToggle(block.id, v === true)}
            disabled={selection.disabled}
          />
        </TableCell>
      )}
      <TableCell>
        <Link href={blockHref(block.id)} className={linkClass} title="Open the flight block card">
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
          {!block.hasContract && block.status !== null && <span className="text-amber-700 dark:text-amber-400">No contract</span>}
        </div>
      </TableCell>
      <TableCell>
        <Ltr className="font-medium">{block.route}</Ltr>
        {flights && (
          <div className={sub}>
            <Ltr>{flights}</Ltr>
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Ltr>
          {formatDateShort(block.outboundDate)} - {formatDateShort(block.inboundDate)}
        </Ltr>
        {flyIn !== null && <div className={sub}>Flies {daysLeftText(Math.max(0, flyIn)).toLowerCase()}</div>}
      </TableCell>
      <TableCell>
        <span className="font-medium tabular-nums">{block.seats}</span>
        {block.originalSeats !== null && (
          <span className="text-xs text-muted-foreground"> of {block.originalSeats} originally</span>
        )}
        <div className={sub}>
          {block.allocated > 0 ? (
            <>
              Allocated {block.allocated}
              {block.allocatedTo.length > 0 && (
                <>
                  : <Ltr>{block.allocatedTo.join(", ")}</Ltr>
                </>
              )}
            </>
          ) : (
            "Not allocated to a departure"
          )}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {block.costPrice === null ? (
          <span className="text-muted-foreground">Not entered</span>
        ) : (
          <>
            <Ltr className="font-medium">{fmtPrice(block.costPrice, block.costCurrency)}</Ltr>
            {block.costTax !== null && block.costTax > 0 && (
              <div className={sub}>
                plus tax <Ltr>{formatNumber(block.costTax)}</Ltr>
              </div>
            )}
          </>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {deadline ? (
          <>
            <span>{deadline.label}</span> <Ltr>{formatDateShort(deadline.date)}</Ltr>
            <div className="mt-0.5">
              <DaysLeft days={deadline.daysLeft} />
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No open deadline</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </TableCell>
    </TableRow>
  );
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
    ? "Say who cancelled: the airline or us"
    : !note.trim()
      ? "A cancellation needs a reason"
      : feeValue === undefined || (feeValue !== null && feeValue < 0)
        ? "The cancellation fee must be a positive number"
        : !date
          ? "The date is missing"
          : null;
  const name = block.seriesName ?? block.seasonLabel ?? `Flight block ${block.id}`;
  const saving = busy === `cancel:${block.id}`;

  const submit = async () => {
    if (problem || !cancelledBy) return;
    const ok = await run(
      `cancel:${block.id}`,
      () => transitionTourBlock(block.id, "cancelled", { date, note, cancelledBy, fee: feeValue ?? null }),
      "Flight block cancelled",
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel Flight Block</DialogTitle>
          <DialogDescription>
            The flight block moves to &quot;Cancelled&quot;. The cancellation is recorded on its timeline and cannot
            be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium" dir="auto">
              {name}
            </span>
            <Ltr>{block.route}</Ltr>
            <Ltr className="text-muted-foreground">
              {formatDateShort(block.outboundDate)} - {formatDateShort(block.inboundDate)}
            </Ltr>
            <span className="text-muted-foreground">{block.seats} seats</span>
          </div>
          {block.allocatedTo.length > 0 && (
            <Notice tone="warning">
              {block.allocatedTo.length === 1 ? "One departure relies" : `${block.allocatedTo.length} departures rely`} on
              this flight block and will be left without a live flight: <Ltr>{block.allocatedTo.join(", ")}</Ltr>
            </Notice>
          )}
          <Field label="Cancelled By" htmlFor="approvals-cancel-by">
            <Select value={cancelledBy} onValueChange={(v) => setCancelledBy(v as CancelledBy)}>
              <SelectTrigger id="approvals-cancel-by">
                <SelectValue placeholder="Select" />
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
            label={`Cancellation Fee Paid${block.costCurrency ? ` (${block.costCurrency})` : ""}`}
            htmlFor="approvals-cancel-fee"
            hint="Leave empty if none was paid."
          >
            <Input
              id="approvals-cancel-fee"
              dir="ltr"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </Field>
          <Field label="Date" htmlFor="approvals-cancel-date">
            <Input id="approvals-cancel-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="approvals-cancel-note">
            <Textarea id="approvals-cancel-note" dir="auto" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {problem && <p className="text-sm text-muted-foreground">{problem}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button type="button" variant="destructive" onClick={() => void submit()} disabled={!!problem || busy !== null}>
            {saving ? "Cancelling..." : "Cancel Flight Block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
