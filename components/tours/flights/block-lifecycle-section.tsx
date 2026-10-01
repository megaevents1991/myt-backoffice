"use client";

/**
 * Lifecycle of a flight block: where it stands, the steps it may take next, and
 * the "reviewed" mark. The dialog collects what each step needs; the server
 * (transitionTourBlock) enforces the same rules again.
 */
import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { setTourBlockReviewed, transitionTourBlock } from "@/lib/actions/tours-flight-actions";
import {
  CONTRACT_DEADLINE_FIELDS,
  DEADLINE_LABELS,
  computeDeadlines,
  formatDateShort,
  pickDeadlines,
} from "@/lib/tours/deadlines";
import {
  CANCELLED_BY,
  CANCELLED_BY_LABELS,
  DRAFT_LABEL,
  MANAGER_ONLY_CANCEL_FROM,
  TRANSITION_ACTION_LABELS,
  checkTransition,
  missingForConfirmed,
  nextStages,
  stageOf,
  type BlockStage,
  type CancelledBy,
  type TransitionInput,
} from "@/components/tours/flights/block-rules";
import { BLOCK_STATUS_LABELS, type BlockStatus } from "@/types/tours.types";
import { fmtPrice, parseNumber } from "@/lib/tours/format";
import { Field, Ltr, Notice, Section } from "@/components/tours/ui";
import { BlockStatusBadge } from "@/components/tours/flights/block-ui";
import type { BlockSectionProps } from "@/components/tours/flights/tour-block-panel";

/** The road a block normally travels. Declined and cancelled are exits from it. */
const MAIN_PATH: BlockStage[] = ["draft", "approved", "requested", "confirmed", "operational", "ticketed"];

const pathLabel = (stage: BlockStage) => (stage === "draft" ? DRAFT_LABEL : BLOCK_STATUS_LABELS[stage]);

export function BlockLifecycleSection({ data, run }: BlockSectionProps) {
  const { block, isManager } = data;
  const stage = stageOf(block.block_status);
  const steps = nextStages(block.block_status);
  const [target, setTarget] = useState<BlockStatus | null>(null);
  const [savingReview, setSavingReview] = useState(false);

  const managerOnly = (to: BlockStatus) =>
    to === "approved" || (to === "cancelled" && MANAGER_ONLY_CANCEL_FROM.includes(stage));
  const blockedForViewer = steps.filter((to) => managerOnly(to) && !isManager);
  const reachedIndex = MAIN_PATH.indexOf(stage);

  const toggleReviewed = async (checked: boolean) => {
    setSavingReview(true);
    await run(() => setTourBlockReviewed(block.id, checked), checked ? "Marked Reviewed" : "Review mark removed");
    setSavingReview(false);
  };

  return (
    <Section
      title="Status"
      description="Every step is recorded on the timeline, with who took it."
      actions={
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={!!block.reviewed_at}
            onCheckedChange={toggleReviewed}
            disabled={!isManager || savingReview}
            aria-label="Reviewed"
          />
          <span className="font-medium">Reviewed</span>
          <span className="text-xs text-muted-foreground">
            {block.reviewed_at ? (
              <>
                {data.reviewedByName ?? "Manager"} · <Ltr>{formatDateShort(block.reviewed_at)}</Ltr>
              </>
            ) : isManager ? (
              "Not reviewed yet"
            ) : (
              "Managers only"
            )}
          </span>
        </label>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Status:</span>
        <BlockStatusBadge status={block.block_status} className="px-3 py-1 text-sm" />
      </div>

      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Flight block stages">
        {MAIN_PATH.filter((s) => s !== "ticketed" || stage === "ticketed").map((s, i) => {
          const isCurrent = s === stage;
          const passed = reachedIndex > -1 && i < reachedIndex;
          return (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5",
                  isCurrent && "border-primary bg-primary text-primary-foreground",
                  passed && "border-transparent bg-muted text-foreground",
                  !isCurrent && !passed && "border-dashed text-muted-foreground",
                )}
              >
                {pathLabel(s)}
              </span>
            </li>
          );
        })}
      </ol>

      {stage === "cancelled" && (
        <Notice tone="error">
          <div className="font-medium">
            Flight block cancelled{block.cancelled_at ? <> on <Ltr>{formatDateShort(block.cancelled_at)}</Ltr></> : null}
          </div>
          {block.cancel_reason && <div className="mt-0.5">{block.cancel_reason}</div>}
          <div className="mt-0.5">
            Cancellation fee: <Ltr>{fmtPrice(block.cancellation_fee, block.cost_currency)}</Ltr>
          </div>
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {steps.length === 0 ? (
          <span className="text-sm text-muted-foreground">No further step from this status.</span>
        ) : (
          steps.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === "cancelled" ? "destructive" : to === "declined" ? "outline" : "default"}
              disabled={managerOnly(to) && !isManager}
              onClick={() => setTarget(to)}
            >
              {TRANSITION_ACTION_LABELS[to]}
            </Button>
          ))
        )}
      </div>
      {blockedForViewer.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {blockedForViewer.includes("approved") && "Approve to book is for the company manager only. "}
          {blockedForViewer.includes("cancelled") && "Only the company manager can cancel a flight block the airline already confirmed."}
        </p>
      )}

      {target && <TransitionDialog key={target} data={data} to={target} run={run} onClose={() => setTarget(null)} />}
    </Section>
  );
}

function TransitionDialog({ data, to, run, onClose }: BlockSectionProps & { to: BlockStatus; onClose: () => void }) {
  const { block, contract } = data;
  const [date, setDate] = useState(data.today);
  const [note, setNote] = useState("");
  const [cancelledBy, setCancelledBy] = useState<CancelledBy | "">("");
  const [fee, setFee] = useState("");
  const [pnr, setPnr] = useState("");
  const [saving, setSaving] = useState(false);

  const feeValue = parseNumber(fee);
  const input: TransitionInput = {
    date,
    note,
    cancelledBy: cancelledBy || null,
    fee: feeValue === undefined ? Number.NaN : feeValue,
    pnr,
  };
  // The viewer's role only matters as "manager or not"; the server checks the real one.
  const check = checkTransition(block, to, data.isManager ? "admin" : "editor", input);
  const needsReason = to === "declined" || to === "cancelled";

  const missing = to === "confirmed" ? missingForConfirmed(block, input) : [];
  const requirements: { label: string; ok: boolean }[] =
    to === "confirmed"
      ? [
          { label: "PNR", ok: !!(block.pnr?.trim() || pnr.trim()) },
          { label: "Seat count", ok: block.initial_quantity > 0 },
          { label: "Adult cost", ok: block.cost_price !== null },
          { label: "Cost currency", ok: !!block.cost_currency },
          { label: "Contract", ok: !!block.contract_id },
        ]
      : [];
  const computed = to === "confirmed" ? computeDeadlines(block.outbound_departure_time, contract) : null;
  const willFill = computed ? pickDeadlines(computed, block, "missing") : {};

  const submit = async () => {
    setSaving(true);
    const res = await run(
      () => transitionTourBlock(block.id, to, { ...input, fee: feeValue ?? null }),
      `Flight block moved to "${BLOCK_STATUS_LABELS[to]}"`,
    );
    setSaving(false);
    if (res.success) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{TRANSITION_ACTION_LABELS[to]}</DialogTitle>
          <DialogDescription>
            The flight block moves to &quot;{BLOCK_STATUS_LABELS[to]}&quot; and the step is recorded on the timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {to === "confirmed" && (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Required for confirmation</div>
              <ul className="grid gap-1 text-sm">
                {requirements.map((r) => (
                  <li key={r.label} className="flex items-center gap-2">
                    {r.ok ? (
                      <Check className="h-4 w-4 text-emerald-600" aria-label="Present" />
                    ) : (
                      <X className="h-4 w-4 text-destructive" aria-label="Missing" />
                    )}
                    <span className={r.ok ? undefined : "font-medium text-destructive"}>{r.label}</span>
                  </li>
                ))}
              </ul>
              {missing.filter((m) => m !== "PNR").length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Fill in what is missing on this card: seats, costs and contract, in the sections below.
                </p>
              )}
            </div>
          )}

          {to === "confirmed" && !block.pnr?.trim() && (
            <Field label="PNR" htmlFor="transition-pnr">
              <Input id="transition-pnr" dir="ltr" value={pnr} onChange={(e) => setPnr(e.target.value)} />
            </Field>
          )}

          {to === "confirmed" && computed && (
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-2 font-medium">Deadlines from the contract</div>
              {!contract ? (
                <p className="text-muted-foreground">Without a contract there are no deadlines to compute.</p>
              ) : (
                <ul className="grid gap-1">
                  {CONTRACT_DEADLINE_FIELDS.map((field) => (
                    <li key={field} className="flex items-center justify-between gap-2">
                      <span>{DEADLINE_LABELS[field]}</span>
                      {willFill[field] ? (
                        <span>
                          <Ltr>{formatDateShort(willFill[field])}</Ltr>{" "}
                          <span className="text-xs text-muted-foreground">computed now</span>
                        </span>
                      ) : block[field] ? (
                        <span>
                          <Ltr>{formatDateShort(block[field])}</Ltr>{" "}
                          <span className="text-xs text-muted-foreground">already set, kept</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">no days in the contract</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {to === "operational" && data.allocations.length === 0 && (
            <Notice tone="warning">The flight block is not allocated to any departure. You can hand it to operations, but it is better to allocate it first.</Notice>
          )}

          {to === "cancelled" && (
            <>
              <Field label="Cancelled By" htmlFor="transition-cancelled-by">
                <Select value={cancelledBy} onValueChange={(v) => setCancelledBy(v as CancelledBy)}>
                  <SelectTrigger id="transition-cancelled-by">
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
                label={`Cancellation Fee Paid${block.cost_currency ? ` (${block.cost_currency})` : ""}`}
                htmlFor="transition-fee"
                hint="Leave empty if none was paid."
              >
                <Input
                  id="transition-fee"
                  dir="ltr"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              </Field>
              {data.allocations.length > 0 && (
                <Notice tone="warning">
                  {data.allocations.length === 1 ? "One departure relies" : `${data.allocations.length} departures rely`} on
                  this flight block and will be left without a live flight: {data.allocations.map((a) => a.code).join(", ")}
                </Notice>
              )}
            </>
          )}

          <Field label={to === "requested" ? "Request Date" : "Date"} htmlFor="transition-date">
            <Input id="transition-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label={needsReason ? "Reason" : "Note (Optional)"} htmlFor="transition-note">
            <Textarea id="transition-note" dir="auto" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {!check.ok && <p className="text-sm text-destructive">{check.error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !check.ok || !date}
            variant={to === "cancelled" ? "destructive" : "default"}
          >
            {saving ? "Saving..." : TRANSITION_ACTION_LABELS[to]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
