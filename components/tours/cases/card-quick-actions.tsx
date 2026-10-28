"use client";

/**
 * The folded card's shortcuts, acting IN PLACE (Alon 22.10: "שלא יפתח את הקארד"), and the same three actions as a
 * "⋯" menu on a TODAY / LEADS row: Notes, Booking link, Follow-up - plus "Take it" on a card nobody holds yet.
 * The bodies are shared: the customer page puts them in popovers, the board in dialogs behind the menu. The
 * booking-link body is booking-link-card.tsx's own OfferSummary (send / send again / withdraw) - building or
 * editing an offer is the one thing that opens the card. A host says how a fresh row lands on screen.
 * NotesCell / OfferCell are the same two bodies behind a board CELL (Alon 28.10: "לערוך את כל השדות כבר במסך
 * רזרויישן") - the cell prints the field, a click edits it in a popover.
 */
import { useState, type ReactNode } from "react";
import { CalendarClock, Link2, MoreHorizontal, StickyNote, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/confirm-provider";
import { isFollowUpDate } from "@/lib/reservations/follow-up";
import { markOfferSent, updateCase, withdrawOffer } from "@/lib/actions/tours-cases-actions";
import type { ActionResult } from "@/lib/tours/action-kit";
import { addDaysIso, canTakeCard, caseName, type CaseRow, type OfferChannel } from "@/lib/tours/cases";
import { EMPTY, fmtDate, isoToJerusalemLocal } from "@/lib/tours/format";
import { noteLine, writtenToday } from "@/lib/tours/board";
import { OfferSummary } from "@/components/tours/cases/booking-link-card";

/** How a screen takes the row an action answered, and how it opens the card when a body needs the whole thing. */
export interface CardActionHost {
  /** Runs an action that answers the fresh row and puts it on screen; true when it went through. */
  apply: (action: () => Promise<ActionResult<CaseRow>>, done: string) => Promise<boolean>;
  /** Opens the card at a section - the customer page unfolds it, the board navigates to it. */
  openCard: (section: "link" | "notes") => void;
}

/** The notes column's limit (updateCase NOTES_MAX). */
const NOTES_MAX = 4000;

/** The card's notes, written here and saved - Save / Cancel. */
export function NotesEditor({ card, host, onDone }: { card: Pick<CaseRow, "id" | "notes">; host: CardActionHost; onDone: () => void }) {
  const [draft, setDraft] = useState(card.notes ?? "");
  const [busy, setBusy] = useState(false);
  const changed = draft.trim() !== (card.notes ?? "").trim();
  const save = async () => {
    setBusy(true);
    const ok = await host.apply(() => updateCase(card.id, { notes: draft }), "Notes saved");
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="space-y-2">
      <Textarea
        dir="auto"
        rows={6}
        maxLength={NOTES_MAX}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="What was said, what was promised, what to do next."
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={busy || !changed}>
          Save notes
        </Button>
      </div>
    </div>
  );
}

/**
 * The offer as it stands, with its send buttons, Send again and Withdraw; "Edit and resend" - and "Build an
 * offer" when there is none - open the card (the builder needs the date picker and the quote).
 */
export function OfferPanel({
  card,
  host,
  onDone,
}: {
  card: Pick<CaseRow, "id" | "offer" | "phone" | "email" | "firstName">;
  host: CardActionHost;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const offer = card.offer ?? null;
  // the link itself opens WhatsApp / the mail app; this records that it went out
  const sent = (via: OfferChannel) => {
    void (async () => {
      setBusy(true);
      await host.apply(() => markOfferSent(card.id, via), 'Recorded as sent - the case is "Offer sent"');
      setBusy(false);
    })();
  };
  const withdraw = async () => {
    const agreed = await confirm({
      title: "Withdraw the offer?",
      description:
        "It leaves the case, and its link no longer lands bookings here (a booking through it is matched by phone like any other). The status stays as it is.",
      confirmLabel: "Withdraw",
      destructive: true,
    });
    if (!agreed) return;
    setBusy(true);
    const ok = await host.apply(() => withdrawOffer(card.id), "Offer withdrawn");
    setBusy(false);
    if (ok) onDone();
  };
  const openBuilder = () => {
    onDone();
    host.openCard("link");
  };
  if (!offer) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">No booking link on this card yet.</p>
        <Button size="sm" variant="outline" onClick={openBuilder}>
          <Link2 className="h-4 w-4" />
          Build an offer
        </Button>
      </div>
    );
  }
  return (
    <OfferSummary
      offer={offer}
      phone={card.phone}
      email={card.email}
      firstName={card.firstName}
      busy={busy}
      onSent={sent}
      onEdit={openBuilder}
      onWithdraw={() => void withdraw()}
    />
  );
}

const QUICK_DAYS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In a week", days: 7 },
] as const;

/** The follow-up day: a date box (saves on a full day) and the quick picks; Clear drops it. */
export function FollowUpPicker({
  card,
  host,
  today,
  onDone,
}: {
  card: Pick<CaseRow, "id" | "followUpDate">;
  host: CardActionHost;
  today: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const save = async (day: string | null) => {
    if (day === card.followUpDate) return onDone();
    setBusy(true);
    const ok = await host.apply(() => updateCase(card.id, { followUpDate: day }), day ? "Follow-up day saved" : "Follow-up day cleared");
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="space-y-3">
      <label className="grid gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Follow-up day{card.followUpDate ? ` · now ${fmtDate(card.followUpDate)}` : ""}</span>
        <Input
          type="date"
          dir="ltr"
          defaultValue={card.followUpDate ?? ""}
          disabled={busy}
          autoFocus
          onChange={(e) => {
            const next = e.target.value;
            if (isFollowUpDate(next) && next >= "2000-01-01") void save(next);
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {QUICK_DAYS.map((q) => (
          <Button key={q.days} size="sm" variant="outline" disabled={busy} onClick={() => void save(addDaysIso(today, q.days))}>
            {q.label}
          </Button>
        ))}
        {card.followUpDate && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** "Take it" - on a card nobody holds: the viewer becomes its rep. Draws nothing on a card that has one. */
export function TakeCardButton({
  card,
  host,
  currentUserId,
  busy,
  className,
}: {
  card: Pick<CaseRow, "id" | "assignedTo">;
  host: CardActionHost;
  currentUserId: string;
  busy?: boolean;
  className?: string;
}) {
  const [working, setWorking] = useState(false);
  if (!canTakeCard(card)) return null;
  const take = async () => {
    setWorking(true);
    await host.apply(() => updateCase(card.id, { assignedTo: currentUserId }), "The card is yours");
    setWorking(false);
  };
  return (
    <Button size="sm" variant="secondary" className={cn("gap-1", className)} disabled={busy || working || !currentUserId} onClick={() => void take()} title="Assign this card to yourself">
      <UserPlus className="h-4 w-4" />
      Take it
    </Button>
  );
}

type Sheet = "notes" | "link" | "followUp";
const SHEET_TITLE: Record<Sheet, string> = { notes: "Notes", link: "Booking link", followUp: "Follow-up" };

/**
 * The "⋯" menu of a board row: Notes / Booking link / Follow-up open the bodies above in a dialog (a table row
 * cannot host a popover from a menu); "Take it" sits in the menu too while the card is unassigned. Clicks inside
 * the dialog never reach the row (the row opens the customer).
 */
export function CardActionsMenu({
  card,
  host,
  today,
  currentUserId,
  busy,
}: {
  card: CaseRow;
  host: CardActionHost;
  today: string;
  currentUserId: string;
  busy?: boolean;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const close = () => setSheet(null);
  return (
    <>
      {/* not modal: a dialog opens from an item, and a modal menu + a modal dialog can leave pointer-events:none on the body */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Actions" title="Notes, booking link, follow-up" disabled={busy}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setSheet("notes")}>
            <StickyNote className="h-4 w-4" />
            Notes
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSheet("link")}>
            <Link2 className="h-4 w-4" />
            Booking link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSheet("followUp")}>
            <CalendarClock className="h-4 w-4" />
            Follow-up
          </DropdownMenuItem>
          {canTakeCard(card) && (
            <DropdownMenuItem onSelect={() => void host.apply(() => updateCase(card.id, { assignedTo: currentUserId }), "The card is yours")}>
              <UserPlus className="h-4 w-4" />
              Take it
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* mounted only while open: each body starts from the row as it is now */}
      {sheet && (
        <Dialog open onOpenChange={(next) => !next && close()}>
          <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>{SHEET_TITLE[sheet]}</DialogTitle>
              <DialogDescription dir="auto">
                {[caseName(card) || card.phone, card.tourName].filter(Boolean).join(" · ") || "Card"}
              </DialogDescription>
            </DialogHeader>
            {sheet === "notes" && <NotesEditor card={card} host={host} onDone={close} />}
            {sheet === "link" && <OfferPanel card={card} host={host} onDone={close} />}
            {sheet === "followUp" && <FollowUpPicker card={card} host={host} today={today} onDone={close} />}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A board cell that prints a field and edits it in a popover; "-" turns into the prompt on hover. */
function CellPopover({
  label,
  prompt,
  title,
  className,
  children,
  body,
}: {
  label: string;
  prompt: string;
  title?: string;
  className?: string;
  /** What the cell prints; null = nothing yet. */
  children: ReactNode | null;
  body: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={title}
          className={cn(
            "group/cell -mx-1 max-w-[16rem] truncate rounded px-1 py-0.5 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {children ?? (
            <span className="text-muted-foreground">
              <span className="group-hover/cell:hidden">{EMPTY}</span>
              <span className="hidden group-hover/cell:inline">{prompt}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* mounted only while open: the body starts from the row as it is now; its clicks never reach the row */}
      <PopoverContent align="start" className="w-80" onClick={(e) => e.stopPropagation()}>
        {open && body(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** The notes column: the first line (bold + a dot when written today), a click writes them. */
export function NotesCell({ card, host, today }: { card: Pick<CaseRow, "id" | "notes" | "notesAt">; host: CardActionHost; today: string }) {
  const line = noteLine(card.notes);
  // a note written today stands out: the rep wrote it this morning and the customer is still on the list
  const fresh = writtenToday(card.notesAt, today);
  return (
    <CellPopover
      label="Notes"
      prompt="+ Note"
      title={card.notes ?? "Write a note"}
      className={fresh ? "font-semibold text-foreground" : "text-muted-foreground"}
      body={(close) => <NotesEditor card={card} host={host} onDone={close} />}
    >
      {line ? (
        <span dir="auto">
          {fresh && <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-label="Written today" />}
          {line}
        </span>
      ) : null}
    </CellPopover>
  );
}

/** Where the card's booking link stands - booked, sent (the day), ready (not sent) - a click works it. */
export function OfferCell({ card, host }: { card: Pick<CaseRow, "id" | "offer" | "phone" | "email" | "firstName">; host: CardActionHost }) {
  const offer = card.offer ?? null;
  const sentDay = offer?.sentAt ? isoToJerusalemLocal(offer.sentAt).slice(0, 10) : "";
  const state = !offer ? null : offer.bookingRef ? (
    <span className="font-medium text-emerald-700 dark:text-emerald-300">Booked</span>
  ) : sentDay ? (
    <span>Sent {fmtDate(sentDay)}</span>
  ) : (
    <span className="font-medium text-amber-700 dark:text-amber-300">Ready, not sent</span>
  );
  return (
    <CellPopover
      label="Booking link"
      prompt="+ Link"
      title={offer ? [offer.departureCode, fmtDate(offer.startDate)].filter(Boolean).join(" · ") : "Build a booking link"}
      body={(close) => <OfferPanel card={card} host={host} onDone={close} />}
    >
      {state}
    </CellPopover>
  );
}
