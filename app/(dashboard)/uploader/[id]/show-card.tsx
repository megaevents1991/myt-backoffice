"use client";

import type { ReactNode } from "react";
import { Check, ExternalLink, GraduationCap, Loader2, Palette, Plane, RotateCw, Route, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SubjectArt } from "@/lib/uploader/action-types";
import { eventSiteUrl } from "@/lib/site";
import { isStaleBuild } from "@/lib/uploader/run-rules";
import { WARNING_TEXT } from "@/lib/uploader/warnings";
import { cn } from "@/lib/utils";
import type { UploaderItem } from "@/types/uploader.types";
import {
  builtPrice,
  creativeLine,
  existingEventId,
  farVenueTarget,
  LEARN_ANYTIME_LINE,
  LEARN_STEP_1,
  LEARN_STEP_1_DONE,
  LEARN_STEP_2,
  rejectedBeforeLine,
  SKIP_REASON_HE,
  stampHe,
  type BusyKind,
} from "./board-words";
import { ACTION, CardShell, Decisions, Notices, RejectButton, StatusPill, SupplierChips, type CardTone } from "./card-shell";

// One show on the review board (spec §5.3 / §11, mockup B): what was built and why, what is
// missing, and the decision buttons - one branch per item status. The question card
// (question-card.tsx) wears the same shell.

/** "בנה כחבילה דרך <city> (X ק"מ) עם פיצול מלון" - shown whenever the card can make the offer; wraps at any width. */
function FarVenueButton({ item, busy, onRebuild }: { item: UploaderItem; busy: BusyKind | null; onRebuild: (item: UploaderItem) => void }) {
  const target = farVenueTarget(item);
  if (!target) return null;
  const caption = (WARNING_TEXT.far_venue ?? "").split(" - ")[0];
  return (
    <div className="space-y-1">
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => onRebuild(item)}
        className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-start text-[13px] leading-snug"
      >
        {busy === "rebuild" ? <Loader2 aria-hidden className="animate-spin" /> : <Route aria-hidden />}
        <span className="min-w-0">{target.text}</span>
      </Button>
    </div>
  );
}

/** The status pill, the mode, the "החל מ-" price and the "נערך" tag - the first line of every built card. */
function HeadLine({ item, edited }: { item: UploaderItem; edited: boolean }) {
  const price = builtPrice(item);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusPill status={item.status} />
      {item.mode && (
        <span className="whitespace-nowrap rounded-full border px-2 py-px text-[11px] text-muted-foreground">
          {item.mode === "package" ? "חבילה" : "כרטיס בלבד"}
        </span>
      )}
      {edited && (
        <span
          title="האירוע שונה בעורך אחרי הבנייה - השינוי יירשם כלקח באישור"
          className="whitespace-nowrap rounded-full bg-info-muted px-2 py-px text-[11px] font-medium text-info"
        >
          נערך
        </span>
      )}
      {price !== null && (
        <span className="ms-auto whitespace-nowrap text-xs text-muted-foreground">
          החל מ-
          <span dir="ltr" className="font-display text-sm font-semibold tabular-nums text-foreground">
            ${price.toLocaleString("en-US")}
          </span>
        </span>
      )}
    </div>
  );
}

/** The fixture / show name when it says more than the subject does (a team's opponent); the flight city of a package. */
function ShowLine({ item, subjectNameEn }: { item: UploaderItem; subjectNameEn: string }) {
  const nameEn = item.show.name_english?.trim() ?? "";
  const nameHe = typeof item.payload?.name === "string" ? item.payload.name.trim() : "";
  const showsName = nameEn !== "" && nameEn.toLowerCase() !== subjectNameEn.trim().toLowerCase();
  const loc = item.mode === "package" ? item.location : null;
  if (!showsName && !loc) return null;
  return (
    <div className="space-y-0.5 text-[13px]">
      {showsName && (
        <div className="font-medium leading-snug">
          {nameHe && nameHe !== nameEn ? (
            <>
              {nameHe} <bdi className="text-xs font-normal text-muted-foreground">{nameEn}</bdi>
            </>
          ) : (
            <bdi>{nameEn}</bdi>
          )}
        </div>
      )}
      {loc && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Plane aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span>
            טיסה: <bdi>{loc.name}</bdi>
            {loc.city_iata && (
              <>
                {" "}
                <bdi dir="ltr" className="font-medium tabular-nums">
                  {loc.city_iata}
                </bdi>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function EditLink({ eventId }: { eventId: number }) {
  return (
    <Button asChild variant="outline" size="sm" className={ACTION}>
      <a href={`/events/${eventId}`} target="_blank" rel="noreferrer">
        <SquarePen aria-hidden />
        ערוך
        <span className="sr-only"> (נפתח בלשונית חדשה)</span>
      </a>
    </Button>
  );
}

function ApproveButton({ item, busy, onApprove }: { item: UploaderItem; busy: BusyKind | null; onApprove: (item: UploaderItem) => void }) {
  const blocker = (item.blockers ?? [])[0];
  const button = (
    <Button
      type="button"
      size="sm"
      disabled={busy !== null || blocker !== undefined}
      onClick={() => onApprove(item)}
      className={cn(ACTION, "min-w-[4.5rem] font-semibold")}
    >
      {busy === "approve" ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
      אשר
    </Button>
  );
  if (!blocker) return <span className="ms-auto">{button}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button fires no pointer events - the span carries the tooltip. */}
        <span tabIndex={0} className="ms-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent dir="rtl" className="max-w-64 text-start">
        חסום: {blocker.text}
      </TooltipContent>
    </Tooltip>
  );
}

function RetryButton({ item, busy, onRetry }: { item: UploaderItem; busy: BusyKind | null; onRetry: (item: UploaderItem) => void }) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => onRetry(item)} className={ACTION}>
      {busy === "retry" ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCw aria-hidden />}
      נסה שוב
    </Button>
  );
}

const Pill = ({ item }: { item: UploaderItem }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <StatusPill status={item.status} />
  </div>
);

/**
 * Learn from an event in two clear steps (spec 5.5, round 2 - Alon: "not clear which flow"). A card with other built
 * shows in its run always shows both: 1. arrange this event in the editor (a link, new tab; "✓" once `fixed` says a person
 * changed something a learn can carry since its last learn); 2. "למדו והחילו" - never locked (second-edit round, Alon: "דרך
 * לתת לזה טריגר"): the board's learn dialog says what changed, who gets it, why not, or that it found nothing.
 */
function LearnSteps({
  item,
  eventId,
  siblings,
  fixed,
  busy,
  onLearn,
}: {
  item: UploaderItem;
  eventId: number;
  siblings: number;
  fixed: boolean;
  busy: BusyKind | null;
  onLearn: (item: UploaderItem) => void;
}) {
  const lineId = `learn-line-${item.id}`;
  return (
    <div className="space-y-1.5 rounded-md border border-info/40 px-2.5 py-2">
      {fixed ? (
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-success">
          <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {LEARN_STEP_1_DONE}
        </p>
      ) : (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-start text-[13px] leading-snug"
        >
          <a href={`/events/${eventId}`} target="_blank" rel="noreferrer">
            <SquarePen aria-hidden />
            <span className="min-w-0">{LEARN_STEP_1}</span>
            <span className="sr-only"> (נפתח בלשונית חדשה)</span>
          </a>
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        aria-describedby={fixed ? undefined : lineId}
        onClick={() => onLearn(item)}
        className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-start text-[13px] leading-snug"
      >
        <GraduationCap aria-hidden />
        <span className="min-w-0">{LEARN_STEP_2(siblings)}</span>
      </Button>
      {!fixed && (
        <p id={lineId} className="text-xs text-muted-foreground">
          {LEARN_ANYTIME_LINE}
        </p>
      )}
    </div>
  );
}

export type ShowCardProps = {
  item: UploaderItem;
  art: SubjectArt;
  subjectNameEn: string;
  edited: boolean;
  /** `RunBoard.editKinds[item.id]` is not empty: a person changed something in the editor a learn can carry (the hall's tickets, a ticket description, the event's description or place) since its last learn - learn step 1 reads "✓". */
  fixedByHand: boolean;
  /** Other ready / approved shows of the run with an event - what "למדו והחילו" may carry an edit to (Alon round 3); above 0 the card shows the two learn steps. */
  learnTargets: number;
  /** The warning codes whose page task already exists (`handedOffCodes`): never printed on the card, never folded. */
  handedOff: ReadonlySet<string>;
  /** The run panel is on screen: the run-level warnings fold into one line that jumps to it. */
  panelShown: boolean;
  /** user id -> display name */
  people: Map<string, string>;
  busy: BusyKind | null;
  focused: boolean;
  now: number;
  onFocusCard: (id: string) => void;
  onApprove: (item: UploaderItem) => void;
  onReject: (item: UploaderItem) => void;
  onRetry: (item: UploaderItem) => void;
  onRebuild: (item: UploaderItem) => void;
  onLearn: (item: UploaderItem) => void;
};

export function ShowCard(props: ShowCardProps) {
  const { item, art, subjectNameEn, edited, fixedByHand, learnTargets, handedOff, panelShown, people, busy, focused, now } = props;
  const { onFocusCard, onApprove, onReject, onRetry, onRebuild, onLearn } = props;
  const learn =
    learnTargets > 0 && item.event_id !== null ? (
      <LearnSteps item={item} eventId={item.event_id} siblings={learnTargets} fixed={fixedByHand} busy={busy} onLearn={onLearn} />
    ) : null;
  const shell = (tone: CardTone, body: ReactNode, footer?: ReactNode) => (
    <CardShell item={item} art={art} tone={tone} focused={focused} onFocusCard={onFocusCard} footer={footer}>
      {body}
    </CardShell>
  );

  switch (item.status) {
    case "ready":
      return shell(
        "default",
        <>
          <HeadLine item={item} edited={edited} />
          <ShowLine item={item} subjectNameEn={subjectNameEn} />
          <SupplierChips item={item} />
          <Decisions item={item} />
          <Notices item={item} fold={panelShown} handedOff={handedOff} />
          {learn}
          <FarVenueButton item={item} busy={busy} onRebuild={onRebuild} />
        </>,
        <>
          {item.event_id !== null && <EditLink eventId={item.event_id} />}
          <RejectButton item={item} busy={busy} onReject={onReject} />
          <ApproveButton item={item} busy={busy} onApprove={onApprove} />
        </>,
      );

    case "approved": {
      const by = item.approved_by ? (people.get(item.approved_by) ?? null) : null;
      return shell(
        "default",
        <>
          <HeadLine item={item} edited={false} />
          <ShowLine item={item} subjectNameEn={subjectNameEn} />
          <SupplierChips item={item} />
          <p className="text-[13px] text-muted-foreground">
            אושר{by ? <> ע״י {by}</> : null}
            {item.approved_at && (
              <>
                {" · "}
                <span dir="ltr" className="tabular-nums">
                  {stampHe(item.approved_at)}
                </span>
              </>
            )}
          </p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Palette aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{creativeLine(item, art)}</span>
          </p>
          <Decisions item={item} />
          {/* an approved event is arranged in the editor too - it teaches its hall the same way (learnFromEvent takes approved items) */}
          {learn}
        </>,
        item.event_id !== null ? (
          <>
            <Button asChild variant="outline" size="sm" className={ACTION}>
              <a href={eventSiteUrl(item.event_id)} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                באתר
                <span className="sr-only"> (נפתח בלשונית חדשה)</span>
              </a>
            </Button>
            <EditLink eventId={item.event_id} />
          </>
        ) : undefined,
      );
    }

    case "skipped": {
      const rejectedLine = item.skip_reason === "rejected_before" ? rejectedBeforeLine(item) : null;
      const reason = rejectedLine ?? (item.skip_reason ? (SKIP_REASON_HE[item.skip_reason] ?? item.skip_reason) : "לא ידוע");
      const existing = item.skip_reason === "exists" ? existingEventId(item) : null;
      const fallback = item.show.fallback ?? [];
      return shell(
        "muted",
        <>
          <Pill item={item} />
          <p className="text-[13px] font-medium text-foreground/80">
            לא נוצר אירוע: {reason}
            {existing !== null && (
              <>
                {" "}
                <a
                  href={`/events/${existing}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <bdi dir="ltr">#{existing}</bdi>
                </a>
              </>
            )}
          </p>
          {fallback.length > 0 && (
            <p className="text-xs">
              נמצא ב-<bdi>{fallback.map((f) => (f === "xs2event" ? "XS2Event" : "P1")).join(" / ")}</bdi> (מידע בלבד)
            </p>
          )}
          <SupplierChips item={item} />
          <Decisions item={item} hide={rejectedLine ? "rejected_before" : undefined} />
          <Notices item={item} fold={panelShown} handedOff={handedOff} />
          <FarVenueButton item={item} busy={busy} onRebuild={onRebuild} />
        </>,
        <Button asChild variant="outline" size="sm" className={ACTION}>
          <a href="/events/new" target="_blank" rel="noreferrer">
            צור ידנית
            <span className="sr-only"> (נפתח בלשונית חדשה)</span>
          </a>
        </Button>,
      );
    }

    case "rejected":
      return shell(
        "muted",
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status="rejected" />
            <span className="text-[11px]">{item.rejected_final ? "לא יוצע שוב" : "יוצע שוב בריצה הבאה"}</span>
          </div>
          {item.rejected_reason && (
            <blockquote dir="auto" className="border-s-2 border-border ps-2.5 text-[13px] text-foreground/80">
              {item.rejected_reason}
            </blockquote>
          )}
          <Decisions item={item} />
        </>,
      );

    case "error":
      return shell(
        "error",
        <>
          <Pill item={item} />
          <p
            dir="auto"
            title={item.error ?? undefined}
            className="line-clamp-4 break-words rounded-md bg-destructive/10 px-2.5 py-2 text-[13px] leading-snug text-destructive"
          >
            {item.error || "הבנייה נכשלה בלי הודעה"}
          </p>
          <SupplierChips item={item} />
          <Decisions item={item} />
        </>,
        <>
          <RetryButton item={item} busy={busy} onRetry={onRetry} />
          <RejectButton item={item} busy={busy} onReject={onReject} />
        </>,
      );

    case "building": {
      const stale = isStaleBuild(item.updated_at, now);
      return shell(
        stale ? "error" : "default",
        <>
          <Pill item={item} />
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {stale ? (
              "הבנייה נקטעה באמצע - נסו שוב"
            ) : (
              <>
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                בונה את האירוע: כרטיסים, מיקום, מחירי בסיס…
              </>
            )}
          </p>
          <SupplierChips item={item} />
        </>,
        stale ? <RetryButton item={item} busy={busy} onRetry={onRetry} /> : undefined,
      );
    }

    case "found":
      return shell(
        "default",
        <>
          <Pill item={item} />
          <ShowLine item={item} subjectNameEn={subjectNameEn} />
          <SupplierChips item={item} />
          <Decisions item={item} />
        </>,
        <RejectButton item={item} busy={busy} onReject={onReject} />,
      );

    default:
      // A status this build does not know (or `question`, which the board hands to QuestionCard).
      return shell(
        "default",
        <>
          <Pill item={item} />
          <SupplierChips item={item} />
          <Decisions item={item} />
        </>,
      );
  }
}
