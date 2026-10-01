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
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  setTourBlockReviewed,
  transitionTourBlock,
  type TourBlockData,
} from "@/lib/actions/tours-flight-actions";
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
import {
  BlockStatusBadge,
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

/** The road a block normally travels. Declined and cancelled are exits from it. */
const MAIN_PATH: BlockStage[] = ["draft", "approved", "requested", "confirmed", "operational", "ticketed"];

const pathLabel = (stage: BlockStage) => (stage === "draft" ? DRAFT_LABEL : BLOCK_STATUS_LABELS[stage]);

export function BlockLifecycleSection({ data, run }: { data: TourBlockData; run: RunAction }) {
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
    await run(() => setTourBlockReviewed(block.id, checked), checked ? "סומן כנבדק" : "סימון הבדיקה הוסר");
    setSavingReview(false);
  };

  return (
    <Section
      title="מחזור חיים"
      description="כל מעבר שלב נרשם בציר האירועים, עם מי שביצע אותו."
      actions={
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={!!block.reviewed_at}
            onCheckedChange={toggleReviewed}
            disabled={!isManager || savingReview}
            aria-label="נבדק"
          />
          <span className="font-medium">נבדק</span>
          <span className="text-xs text-muted-foreground">
            {block.reviewed_at ? (
              <>
                {data.reviewedByName ?? "מנהל"} · <Ltr>{formatDateShort(block.reviewed_at)}</Ltr>
              </>
            ) : isManager ? (
              "עוד לא נבדק"
            ) : (
              "רק מנהל החברה מסמן"
            )}
          </span>
        </label>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">סטטוס:</span>
        <BlockStatusBadge status={block.block_status} className="px-3 py-1 text-sm" />
      </div>

      <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label="שלבי הבלוק">
        {MAIN_PATH.filter((s) => s !== "ticketed" || stage === "ticketed").map((s, i) => {
          const isCurrent = s === stage;
          const passed = reachedIndex > -1 && i < reachedIndex;
          return (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground">←</span>}
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
        <div className="mt-3">
          <Notice tone="danger">
            <div className="font-medium">
              הבלוק בוטל{block.cancelled_at ? <> ב-<Ltr>{formatDateShort(block.cancelled_at)}</Ltr></> : null}
            </div>
            {block.cancel_reason && <div className="mt-0.5">{block.cancel_reason}</div>}
            <div className="mt-0.5">
              דמי ביטול: <Ltr>{formatMoney(block.cancellation_fee, block.cost_currency)}</Ltr>
            </div>
          </Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {steps.length === 0 ? (
          <span className="text-sm text-muted-foreground">אין שלב נוסף מהסטטוס הזה.</span>
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
        <p className="mt-2 text-xs text-muted-foreground">
          {blockedForViewer.includes("approved") && "אישור להזמנה שמור למנהל החברה. "}
          {blockedForViewer.includes("cancelled") && "בלוק שכבר אושר בחברת התעופה מבוטל רק על ידי מנהל החברה."}
        </p>
      )}

      {target && <TransitionDialog key={target} data={data} to={target} run={run} onClose={() => setTarget(null)} />}
    </Section>
  );
}

function TransitionDialog({
  data,
  to,
  run,
  onClose,
}: {
  data: TourBlockData;
  to: BlockStatus;
  run: RunAction;
  onClose: () => void;
}) {
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
          { label: "כמות מושבים", ok: block.initial_quantity > 0 },
          { label: "עלות מבוגר", ok: block.cost_price !== null },
          { label: "מטבע העלות", ok: !!block.cost_currency },
          { label: "חוזה", ok: !!block.contract_id },
        ]
      : [];
  const computed = to === "confirmed" ? computeDeadlines(block.outbound_departure_time, contract) : null;
  const willFill = computed ? pickDeadlines(computed, block, "missing") : {};

  const submit = async () => {
    setSaving(true);
    const ok = await run(
      () => transitionTourBlock(block.id, to, { ...input, fee: feeValue ?? null }),
      `הבלוק עבר ל"${BLOCK_STATUS_LABELS[to]}"`,
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <RtlDialogContent className="sm:max-w-lg">
        <RtlDialogHeader>
          <DialogTitle>{TRANSITION_ACTION_LABELS[to]}</DialogTitle>
          <DialogDescription>
            הבלוק יעבור לסטטוס &quot;{BLOCK_STATUS_LABELS[to]}&quot; והמעבר יירשם בציר האירועים.
          </DialogDescription>
        </RtlDialogHeader>

        <div className="grid gap-4">
          {to === "confirmed" && (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">מה נדרש לאישור</div>
              <ul className="grid gap-1 text-sm">
                {requirements.map((r) => (
                  <li key={r.label} className="flex items-center gap-2">
                    {r.ok ? (
                      <Check className="h-4 w-4 text-emerald-600" aria-label="קיים" />
                    ) : (
                      <X className="h-4 w-4 text-destructive" aria-label="חסר" />
                    )}
                    <span className={r.ok ? undefined : "font-medium text-destructive"}>{r.label}</span>
                  </li>
                ))}
              </ul>
              {missing.filter((m) => m !== "PNR").length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  את החסר משלימים בכרטיס הבלוק: מושבים, עלויות וחוזה בחלקים שמתחת.
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
              <div className="mb-2 font-medium">מועדים מהחוזה</div>
              {!contract ? (
                <p className="text-muted-foreground">בלי חוזה אין מועדים לחשב.</p>
              ) : (
                <ul className="grid gap-1">
                  {CONTRACT_DEADLINE_FIELDS.map((field) => (
                    <li key={field} className="flex items-center justify-between gap-2">
                      <span>{DEADLINE_LABELS[field]}</span>
                      {willFill[field] ? (
                        <span>
                          <Ltr>{formatDateShort(willFill[field])}</Ltr>{" "}
                          <span className="text-xs text-muted-foreground">יחושב עכשיו</span>
                        </span>
                      ) : block[field] ? (
                        <span>
                          <Ltr>{formatDateShort(block[field])}</Ltr>{" "}
                          <span className="text-xs text-muted-foreground">כבר הוזן, נשאר</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">אין ימים בחוזה</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {to === "operational" && data.allocations.length === 0 && (
            <Notice tone="warning">הבלוק לא משויך לאף יציאה. אפשר להעביר לתפעול, אבל כדאי לשייך קודם.</Notice>
          )}

          {to === "cancelled" && (
            <>
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
                label={`דמי ביטול ששולמו${block.cost_currency ? ` (${block.cost_currency})` : ""}`}
                htmlFor="transition-fee"
                hint="להשאיר ריק אם לא שולמו."
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
                  {data.allocations.length === 1 ? "יציאה אחת נשענת" : `${data.allocations.length} יציאות נשענות`} על
                  הבלוק הזה ויישארו בלי טיסה חיה: {data.allocations.map((a) => a.code).join(", ")}
                </Notice>
              )}
            </>
          )}

          <Field label={to === "requested" ? "תאריך הבקשה" : "תאריך"} htmlFor="transition-date">
            <Input id="transition-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label={needsReason ? "סיבה" : "הערה (לא חובה)"} htmlFor="transition-note">
            <Textarea id="transition-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {!check.ok && <p className="text-sm text-destructive">{check.error}</p>}
        </div>

        <RtlDialogFooter>
          <Button
            onClick={submit}
            disabled={saving || !check.ok || !date}
            variant={to === "cancelled" ? "destructive" : "default"}
          >
            {saving ? "שומר..." : TRANSITION_ACTION_LABELS[to]}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}
