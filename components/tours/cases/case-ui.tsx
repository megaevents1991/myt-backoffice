"use client";

/**
 * The small pieces the Reservations table and the case page share: the status
 * tag, the TYPE and TASK badges, and the status / rep pickers.
 */
import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Loader2, Mail, MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActionData } from "@/hooks/use-action-data";
import { isFollowUpDate } from "@/lib/reservations/follow-up";
import { listFutureTours } from "@/lib/actions/tours-cases-actions";
import {
  BOOKING_PHASE_LABELS,
  CARD_STAGES,
  CASE_TYPE_LABELS,
  CLOSE_REASON_MAX,
  CLOSE_REASON_MIN,
  CLOSE_REASON_PRESETS,
  SEASON_MAX,
  STATUS_COLOR_CLASSES,
  TODAY_REASON_LABELS,
  caseName,
  cardStage,
  checkCloseReason,
  checkFuture,
  customerLabel,
  daysLate,
  needsCloseReason,
  statusOf,
  waLink,
  whatsappAppLink,
  type BookingPhase,
  type CaseRep,
  type CaseRow,
  type CaseStatus,
  type CaseType,
  type FutureTour,
  type KnownFrom,
  type TodayReason,
} from "@/lib/tours/cases";
import { EMPTY, fmtDate } from "@/lib/tours/format";

/** Value of the rep picker for "nobody". */
export const NOBODY = "nobody";

/** Who a row is: the name over the bare customer number (every board table). The phone is its own column (Alon 21.10). */
export function CardWho({ card, children }: { card: CaseRow; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div dir="auto" className="truncate font-medium">
        {caseName(card) || card.phone || card.email || "Customer"}
        {children}
      </div>
      {card.customerNo && <div className="font-mono text-xs text-muted-foreground">{customerLabel(card.customerNo)}</div>}
    </div>
  );
}

/** The phone, readable and copyable on its own (Alon 21.10: "עמודת טלפון"). */
export function PhoneCell({ phone }: { phone: string | null }) {
  return phone ? (
    <span dir="ltr" className="tabular whitespace-nowrap text-sm">
      {phone}
    </span>
  ) : (
    <span className="text-muted-foreground">{EMPTY}</span>
  );
}

/**
 * A mail shortcut: the rep's OWN mail app (mailto). Dor 21.10: an offer or support correspondence goes from the
 * rep's mailbox; an order confirmation, a receipt or trip material goes from the company's with the rep in CC -
 * those sends do not exist yet, so this is the rep side only.
 */
export function MailButton({ email, iconOnly }: { email: string | null; iconOnly?: boolean }) {
  if (!email) return null;
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
        <a href={`mailto:${email}`} aria-label="Email - opens your mail app" title={`Email ${email} from your mail app`}>
          <Mail className="h-4 w-4" />
        </a>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={`mailto:${email}`} title={`Email ${email} from your mail app`}>
        <Mail className="h-4 w-4" />
        Email
      </a>
    </Button>
  );
}

/** "Known customer · was X · reason" - what a card knows of the customer's earlier deals (under the Card column since 21.10). */
export function KnownLine({ known, statuses }: { known: KnownFrom; statuses: readonly CaseStatus[] }) {
  return (
    <div className="max-w-[16rem] text-xs font-medium text-violet-700 dark:text-violet-300">
      Known customer · was <span dir="rtl">{statusOf(known.status, statuses)?.label ?? known.status}</span>
      {known.closeReason && (
        <>
          {" "}
          · <span dir="auto">{known.closeReason}</span>
        </>
      )}
    </div>
  );
}

/** The bulk bar's "Set rep…" (managers only since 21.10). `null` = unassigned. */
export function BulkAssignSelect({ reps, disabled, onAssign }: { reps: readonly CaseRep[]; disabled: boolean; onAssign: (id: string | null) => void }) {
  return (
    <Select disabled={disabled} onValueChange={(id) => onAssign(id === NOBODY ? null : id)}>
      <SelectTrigger className="h-8 w-40 text-foreground" aria-label="Set rep">
        <SelectValue placeholder="Set rep…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Unassigned</SelectItem>
        {reps.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What a deal is for: the tour, then its date or season. */
export function CardWhat({ card, children }: { card: CaseRow; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div dir="auto" className="truncate">
        {card.tourName ?? <span className="text-muted-foreground">Tour not chosen</span>}
      </div>
      <div dir="auto" className="tabular text-xs text-muted-foreground">
        {card.departureCode ? `${card.departureCode}${card.departureDate ? ` · ${fmtDate(card.departureDate)}` : ""}` : (card.season ?? "No date yet")}
      </div>
      {card.waUnseen > 0 && (
        <span
          className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
          title="הודעות חדשות בוואטסאפ"
        >
          💬 {card.waUnseen}
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * A control inside a clickable table row. Radix menus render in a portal but
 * React still bubbles their clicks up to the row - this stops them here, so
 * picking a status never opens the case.
 */
export function InRow({ children, className }: { children: ReactNode; className?: string }) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <div className={className} onClick={stop}>
      {children}
    </div>
  );
}

export function StatusTag({ status, statuses, className }: { status: string; statuses: readonly CaseStatus[]; className?: string }) {
  const found = statusOf(status, statuses);
  return (
    <span
      dir="auto"
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        STATUS_COLOR_CLASSES[found?.color ?? "gray"],
        className,
      )}
    >
      {found?.label ?? status}
    </span>
  );
}

/**
 * TYPE is the first thing a rep reads on a row (Alon 18.10: "start with TYPE and TASK"), so each type owns a
 * hue: booked = green, a lead = blue, a future interest = violet with a dashed edge (nothing to sell yet).
 * The word is always printed - the colour only speeds the eye.
 */
export const TYPE_CLASSES: Record<CaseType, string> = {
  reservation: "border-green-600/30 bg-green-500/10 text-green-800 dark:text-green-300",
  lead: "border-blue-600/30 bg-blue-500/10 text-blue-800 dark:text-blue-300",
  potential: "border-dashed border-violet-500/50 bg-violet-500/5 text-violet-800 dark:text-violet-300",
};
/** The wash a case's header takes from its type (the case page). */
export const TYPE_WASH: Record<CaseType, string> = {
  reservation: "border-green-600/25 bg-[linear-gradient(rgb(34_197_94/0.07),rgb(34_197_94/0.02))]",
  lead: "border-blue-600/25 bg-[linear-gradient(rgb(59_130_246/0.07),rgb(59_130_246/0.02))]",
  potential: "border-violet-500/25 bg-[linear-gradient(rgb(139_92_246/0.07),rgb(139_92_246/0.02))]",
};

export function TypeBadge({ type }: { type: CaseType }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", TYPE_CLASSES[type])}>
      {CASE_TYPE_LABELS[type]}
    </span>
  );
}

/** Why a card waits for a rep (TODAY): the reason owns a hue, the words are always printed. */
const REASON_CLASSES: Record<TodayReason, string> = {
  returned: "border-violet-500/35 bg-violet-500/10 text-violet-800 dark:text-violet-300",
  whatsapp: "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  payment: "border-orange-500/35 bg-orange-500/10 text-orange-800 dark:text-orange-300",
  file: "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-300",
  new: "border-blue-500/35 bg-blue-500/10 text-blue-800 dark:text-blue-300",
  late: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300",
  today: "border-slate-500/35 bg-slate-500/10 text-slate-800 dark:text-slate-300",
  confirmation: "border-teal-500/35 bg-teal-500/10 text-teal-800 dark:text-teal-300",
};

/**
 * A TODAY row wears its reason (Alon 21.10: "שהשורה תהיה צבועה בצבע מרקר אחר") - the badge's hue as a wash, and a
 * marker bar on the first cell. Spelled out in full: Tailwind reads literals only.
 */
export const TODAY_ROW_CLASSES: Record<TodayReason, string> = {
  returned: "bg-violet-500/10 hover:bg-violet-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-violet-500",
  whatsapp: "bg-emerald-500/10 hover:bg-emerald-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-emerald-500",
  payment: "bg-orange-500/10 hover:bg-orange-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-orange-500",
  file: "bg-amber-500/10 hover:bg-amber-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-amber-500",
  new: "bg-blue-500/10 hover:bg-blue-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-blue-500",
  late: "bg-red-500/10 hover:bg-red-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-red-500",
  today: "bg-slate-500/10 hover:bg-slate-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-slate-500",
  confirmation: "bg-teal-500/10 hover:bg-teal-500/15 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-teal-500",
};

export function TodayBadge({ reason, followUpDate, today }: { reason: TodayReason | null; followUpDate?: string | null; today?: string }) {
  if (!reason) return <span className="text-muted-foreground">-</span>;
  const late = reason === "late" && followUpDate && today ? daysLate(followUpDate, today) : 0;
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold", REASON_CLASSES[reason])}>
      {late ? `Late ${late} ${late === 1 ? "day" : "days"}` : TODAY_REASON_LABELS[reason]}
    </span>
  );
}

/** Lead -> Offer -> Order -> Paid: four short bars in the status's own colour, the step named after them. */
export function StageBar({ status, hasOrder, statuses, className }: { status: string; hasOrder: boolean; statuses: readonly CaseStatus[]; className?: string }) {
  const stage = cardStage(status, hasOrder, statuses);
  if (stage === null) return null;
  const color = statusOf(status, statuses)?.color ?? "gray";
  const fill = STAGE_FILL[color] ?? "bg-foreground/60";
  const label = stage === 2.5 ? "Deposit" : CARD_STAGES[Math.floor(stage)];
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title="Lead → Offer → Order → Paid">
      {CARD_STAGES.map((name, i) => (
        <span key={name} className={cn("h-1 w-5 rounded-full bg-border", i <= stage && fill, stage === 2.5 && i === 3 && cn(fill, "opacity-40"))} />
      ))}
      <span className="ms-1 text-[11px] font-medium text-muted-foreground">{label}</span>
    </span>
  );
}
const STAGE_FILL: Record<string, string> = {
  blue: "bg-blue-500",
  slate: "bg-slate-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  indigo: "bg-indigo-500",
  cyan: "bg-cyan-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  green: "bg-green-600",
  gray: "bg-muted-foreground",
};

/** What a future lead names besides its status (Nir 19.10): the tour and the season. */
export interface FuturePick {
  packageId: string;
  season: string;
}

const OTHER_SEASON = "__other";

/**
 * "ליד עתידי" asks for the tour and the season before it is saved: the seasons the tour's coming departures carry,
 * then the tour's own seasons, or one typed by hand.
 */
export function FutureDialog({
  open,
  initial,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initial: { packageId: string | null; season: string | null };
  onCancel: () => void;
  onConfirm: (pick: FuturePick) => void;
}) {
  const { data: tours, loading } = useActionData<FutureTour[]>(
    () => (open ? listFutureTours() : Promise.resolve({ success: true as const, data: [] as FutureTour[] })),
    [open],
  );
  const [packageId, setPackageId] = useState<string>(initial.packageId ?? "");
  const [season, setSeason] = useState<string>(initial.season ?? "");
  const [typed, setTyped] = useState(false);
  const tour = tours?.find((t) => t.id === packageId);
  const seasons = tour?.seasons ?? [];
  const problem = checkFuture(packageId || null, season);
  const close = () => {
    setTyped(false);
    onCancel();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            Future lead <span dir="rtl">(ליד עתידי)</span>
          </DialogTitle>
          <DialogDescription>Which tour, and which season - the card comes back to TODAY on its follow-up day.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Tour</span>
            <Select
              value={packageId}
              disabled={loading}
              onValueChange={(next) => {
                setPackageId(next);
                setSeason("");
                setTyped(false);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Loading tours…" : "Choose a tour"} />
              </SelectTrigger>
              <SelectContent>
                {(tours ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span dir="auto">{t.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Season</span>
            {typed || (packageId && seasons.length === 0) ? (
              <Input dir="auto" maxLength={SEASON_MAX} value={season} onChange={(e) => setSeason(e.target.value)} placeholder="פסח 2027" autoFocus />
            ) : (
              <Select
                value={season && seasons.includes(season) ? season : ""}
                disabled={!packageId}
                onValueChange={(next) => (next === OTHER_SEASON ? (setTyped(true), setSeason("")) : setSeason(next))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={packageId ? "Choose a season" : "Choose the tour first"} />
                </SelectTrigger>
                <SelectContent>
                  {seasons.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span dir="rtl">{s}</span>
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_SEASON}>Another season…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Keep the status
          </Button>
          <Button
            disabled={!!problem}
            onClick={() => {
              if (problem) return;
              setTyped(false);
              onConfirm({ packageId, season: season.trim() });
            }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Save as future lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The company's active statuses, plus the case's own one when it was switched off since. A status
 * that closes the case without a deal (Not relevant, Cancelled, ...) first asks why - the change is
 * saved only with a reason (Alon 15.10); cancelling the question keeps the old status. "ליד עתידי"
 * first asks for the tour and the season (Nir 19.10).
 */
export function StatusSelect({
  value,
  statuses,
  disabled,
  onChange,
  className,
  title,
  future,
}: {
  value: string;
  statuses: readonly CaseStatus[];
  disabled?: boolean;
  onChange: (status: string, closeReason?: string, pick?: FuturePick) => void;
  className?: string;
  /** Hover text - the close reason of a closed case. */
  title?: string;
  /** The card's tour and season - what the future-lead question starts from. */
  future?: { packageId: string | null; season: string | null };
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [askingFuture, setAskingFuture] = useState(false);
  const offered = statuses.filter((s) => s.isActive || s.key === value);
  const pick = (next: string) => {
    if (needsCloseReason(next, statuses)) return setAsking(next);
    if (next === "future") return setAskingFuture(true);
    onChange(next);
  };
  return (
    <>
      {/* mounted only while asked: it reads the tours then, and starts from the card's own tour and season */}
      {askingFuture && (
        <FutureDialog
          open
          initial={future ?? { packageId: null, season: null }}
          onCancel={() => setAskingFuture(false)}
          onConfirm={(choice) => {
            setAskingFuture(false);
            onChange("future", undefined, choice);
          }}
        />
      )}
      <Select value={value} disabled={disabled} onValueChange={pick}>
        <SelectTrigger aria-label="Status" title={title} className={cn("h-8 w-auto min-w-[8rem] gap-1 border-none bg-transparent px-1 shadow-none", className)}>
          <SelectValue>
            <StatusTag status={value} statuses={statuses} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {offered.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              <StatusTag status={s.key} statuses={statuses} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <CloseReasonDialog
        status={asking}
        statuses={statuses}
        onCancel={() => setAsking(null)}
        onConfirm={(reason) => {
          if (asking) onChange(asking, reason);
          setAsking(null);
        }}
      />
    </>
  );
}

/**
 * "Why is it closed?" - one click on a common reason or the rep's own words; Save stays off until
 * there is a reason (CLOSE_REASON_MIN). `status` null = closed. Used by one case and by the bulk bar.
 */
export function CloseReasonDialog({
  status,
  statuses,
  count,
  onCancel,
  onConfirm,
}: {
  status: string | null;
  statuses: readonly CaseStatus[];
  /** Several cases at once (the bulk bar). */
  count?: number;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const checked = checkCloseReason(reason);
  const label = status ? (statusOf(status, statuses)?.label ?? status) : "";
  const close = () => {
    setReason("");
    onCancel();
  };
  return (
    <Dialog open={status !== null} onOpenChange={(open) => !open && close()}>
      {/* inside a clickable table row: a click in the dialog must not open the case */}
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            Why {count && count > 1 ? `are ${count} cases` : "is the case"} <span dir="auto">&quot;{label}&quot;</span>?
          </DialogTitle>
          <DialogDescription>The reason is saved on the case and shows in the table - the team learns why customers drop.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" dir="rtl">
          {CLOSE_REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              aria-pressed={reason === preset}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                reason === preset && "border-primary bg-primary/10 text-primary",
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="grid gap-1">
          <label htmlFor="close-reason" className="text-sm font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <Textarea
            id="close-reason"
            dir="auto"
            rows={3}
            maxLength={CLOSE_REASON_MAX}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="What happened - in a few words"
            aria-invalid={reason.length > 0 && !checked.ok}
          />
          <p className="text-xs text-muted-foreground">Required - at least {CLOSE_REASON_MIN} characters.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Keep the status
          </Button>
          <Button
            disabled={!checked.ok}
            onClick={() => {
              if (!checked.ok) return;
              setReason("");
              onConfirm(checked.reason);
            }}
          >
            Save with reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * WhatsApp to the customer from the rep's OWN app: whatsapp:// opens WhatsApp Desktop (or the phone's
 * app) on the chat, no browser tab (Alon 15.10). The menu keeps WhatsApp Web for a computer without
 * the app. Nothing when the phone cannot be a WhatsApp number.
 */
export function WhatsAppButton({ phone, message, iconOnly }: { phone: string | null; message: string; iconOnly?: boolean }) {
  const app = whatsappAppLink(phone, message);
  const web = waLink(phone, message);
  if (!app || !web) return null;
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:text-success" asChild>
        <a href={app} aria-label="WhatsApp - opens the WhatsApp app" title="Opens WhatsApp on this computer">
          <MessageCircle className="h-4 w-4" />
        </a>
      </Button>
    );
  }
  return (
    <div className="inline-flex items-center">
      <Button variant="outline" size="sm" className="rounded-e-none" asChild>
        <a href={app} title="Opens WhatsApp on this computer">
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-s-none border-s-0 px-1.5" aria-label="More WhatsApp options">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={web} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open in WhatsApp Web
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const PHASE_CLASSES: Record<BookingPhase, string> = {
  active: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  past: "border-border bg-muted text-muted-foreground",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

/** Active / Past / Cancelled - where one of the customer's orders stands. */
export function PhaseTag({ phase }: { phase: BookingPhase }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", PHASE_CLASSES[phase])}>
      {BOOKING_PHASE_LABELS[phase]}
    </span>
  );
}

/**
 * A field inside a table row reads as plain text until the pointer or the keyboard reaches
 * it - fourteen bordered boxes per row made the table look like a form.
 */
export const GHOST_FIELD =
  "border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-input focus-visible:bg-background data-[state=open]:border-input";

export function RepSelect({
  value,
  reps,
  currentUserId,
  disabled,
  onChange,
  className,
  ghost,
}: {
  value: string | null;
  reps: readonly CaseRep[];
  currentUserId: string;
  disabled?: boolean;
  onChange: (rep: string | null) => void;
  className?: string;
  /** In a table row: no box until hovered or focused. */
  ghost?: boolean;
}) {
  const name = value ? (reps.find((p) => p.id === value)?.name ?? "Another teammate") : "";
  return (
    <Select value={value ?? NOBODY} disabled={disabled} onValueChange={(id) => onChange(id === NOBODY ? null : id)}>
      <SelectTrigger aria-label="Rep" className={cn("h-8 w-auto min-w-[8rem] gap-1", ghost && cn(GHOST_FIELD, "px-2"), className)}>
        <SelectValue>
          <span dir="auto" className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? name : "Unassigned"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Unassigned</SelectItem>
        {reps.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
            {p.id === currentUserId ? " (me)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The follow-up day, edited in place. Uncontrolled like the Mega Events
 * reservations' box: a picked or fully typed day saves at once, an emptied box
 * saves on blur - a controlled box saved every half-typed day (a year typed digit
 * by digit read as "0002-10-14"), so a day from before 2000 never saves.
 */
export function FollowUpInput({
  value,
  due,
  onSave,
  className,
  ghost,
}: {
  value: string | null;
  due: boolean;
  onSave: (next: string | null) => void;
  className?: string;
  /** In a table row: no box, and an empty day hides the browser's "dd/mm/yyyy" until hovered. */
  ghost?: boolean;
}) {
  return (
    <input
      // remount when the stored day changes elsewhere (a bulk change, a failed save)
      key={value ?? "none"}
      type="date"
      dir="ltr"
      aria-label="Follow-up day"
      title={due ? "The follow-up day has come" : "The day to get back to the customer"}
      defaultValue={value ?? ""}
      onChange={(e) => {
        const next = e.target.value;
        if (isFollowUpDate(next) && next >= "2000-01-01" && next !== value) onSave(next);
      }}
      onBlur={(e) => {
        if (e.target.value === "" && value) onSave(null);
      }}
      className={cn(
        "h-8 w-36 rounded-md border border-input bg-background px-2 text-sm tabular text-foreground",
        due && "border-destructive font-semibold text-destructive",
        ghost && GHOST_FIELD,
        ghost && !value && "text-transparent hover:text-muted-foreground focus:text-foreground",
        className,
      )}
    />
  );
}
