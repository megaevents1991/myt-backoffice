"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ExternalLink,
  ImageOff,
  Loader2,
  Plane,
  RotateCw,
  Route,
  SquarePen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SubjectArt } from "@/lib/uploader/action-types";
import { siteCardPrice, type SiteCardPriceEvent } from "@/lib/package-price";
import { eventSiteUrl } from "@/lib/site";
import { canRebuildTwoCity, isStaleBuild, REJECTABLE_STATUSES } from "@/lib/uploader/run-rules";
import { farVenueOffer, WARNING_TEXT } from "@/lib/uploader/warnings";
import { cn } from "@/lib/utils";
import type { ItemStatus, UploaderItem, Warning } from "@/types/uploader.types";

// One show on the review board (spec §5.3, mockup B): the picture the site will draw, where and
// when, what was built and why, what is missing, and the decision buttons. The question card
// (question-card.tsx) wears the same shell. Helpers the rest of the board shares live here too.

// ---- shared words --------------------------------------------------------------------------------

/** Every ITEM_STATUSES value as the card's pill says it - a status added to the type fails to compile here. */
export const ITEM_STATUS_HE: Record<ItemStatus, string> = {
  found: "ממתין לבנייה",
  building: "בבנייה",
  question: "שאלה חוסמת",
  ready: "מוכן",
  approved: "באתר ✓",
  skipped: "דולג",
  rejected: "נדחה",
  error: "שגיאה",
};

const STATUS_STYLE: Record<ItemStatus, string> = {
  found: "bg-muted text-muted-foreground",
  building: "bg-info-muted text-info",
  question: "bg-warning-muted text-warning",
  ready: "bg-success-muted text-success",
  approved: "bg-brand-forest text-brand-mint",
  skipped: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/10 text-destructive",
  error: "bg-destructive/15 text-destructive",
};

/** A server action's refusal in the board's words. */
const KIND_HE: Record<string, string> = {
  not_ready: "לא מוכן",
  blocked: "חסום",
  event_gone: "האירוע נמחק",
  time_budget: "נגמר הזמן - לחצו שוב",
  db_error: "השמירה נכשלה - נסו שוב",
  bad_input: "הבקשה לא תקינה",
  not_found: "ההופעה לא נמצאה - רעננו את הדף",
  not_question: "השאלה כבר נענתה",
  bad_answer: "התשובה לא מתאימה לשאלה - בחרו אחת מהאפשרויות",
  split_failed: "התשובה נשמרה, אבל פיצול ההופעות לא הושלם",
  task_not_closed: "התשובה נשמרה, אבל המשימה לא נסגרה",
  not_rejectable: "אי אפשר לדחות הופעה במצב הזה",
  not_retryable: "אין מה לנסות שוב - ההופעה כבר זזה",
  not_rebuildable: "אי אפשר לבנות את ההופעה מחדש במצב הזה",
  no_coordinates: "לאולם אין קואורדינטות - בנו ידנית",
  location_not_found: "המיקום לא נמצא",
  location_no_iata: "למיקום אין קוד שדה תעופה",
  event_not_deleted: "האירוע הקודם לא נמחק - שום דבר לא השתנה",
  not_running: "הריצה כבר לא בבנייה",
  not_resumable: "אין מה להמשיך בריצה הזו",
  stopped: "הריצה נעצרה",
};

/** A `kind` in Hebrew; anything this build does not know reads as the generic line. */
export function kindText(kind: string | undefined | null): string {
  return (kind && KIND_HE[kind]) || "משהו השתבש";
}

/** "2027-05-20" -> "20.05.2027" (the show's calendar day as the supplier prints it - no time zone). */
export function showDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** A timestamp in Israel time, "21.10.2026, 14:22". */
export function stampHe(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "לונדון 20.05" - how a toast names one show. */
export function showLabel(item: UploaderItem): string {
  return `${item.show.city || item.show.venue || item.show.name_english} ${showDate(item.show.date).slice(0, 5)}`;
}

/** Why a show was not built, in Hebrew (`uploader_items.skip_reason`); an unknown reason prints as stored. */
const SKIP_REASON_HE: Record<string, string> = {
  no_tickets: "אין כרטיסים למכירה",
  no_location: "אין לוקיישן",
  exists: "כבר קיים באתר",
  rejected_before: "נדחה בעבר",
  skipped_by_answer: "דולג לפי תשובה",
};

/** Subject-level warning codes and their short chip text in the header (mockup: "cut-out ✗"). */
export const SUBJECT_WARNING_CHIP: Record<string, string> = {
  no_artist_page: "אין עמוד אמן",
  no_team_page: "אין עמוד קבוצה",
  no_cutout: "cut-out ✗",
  no_event_gallery: "גלריית אירועים ✗",
  no_crest: "סמל ✗",
  no_bio: "ביוגרפיה ✗",
};

export type BusyKind = "approve" | "reject" | "answer" | "retry" | "rebuild";

export const isRejectable = (item: UploaderItem): boolean => REJECTABLE_STATUSES.includes(item.status);
export const isApprovable = (item: UploaderItem): boolean => item.status === "ready" && (item.blockers ?? []).length === 0;

/** The far-venue offer the card may make: the item's nearest location, when the rule lets it rebuild two-city. */
export function farVenueTarget(item: UploaderItem): { id: number; text: string } | null {
  if (!item.location || !canRebuildTwoCity(item)) return null;
  const offered = (item.warnings ?? []).some((w) => w.code === "far_venue") || item.location.far;
  return offered ? { id: item.location.id, text: farVenueOffer(item.location.name, item.location.km) } : null;
}

// ---- the built event, read off the stored payload --------------------------------------------------

type PayloadTicket = { supplier?: unknown };

function payloadTickets(item: UploaderItem): PayloadTicket[] | null {
  const t = item.payload?.tickets_and_rates;
  return Array.isArray(t) ? (t as PayloadTicket[]) : null;
}

/** "החל מ-$X" of the built event - main's card rule over the row the builder wrote; null before it is built. */
function builtPrice(item: UploaderItem): number | null {
  if (!item.payload || payloadTickets(item) === null) return null;
  // The payload IS the created `events` row (minus volatile columns) - the shape siteCardPrice reads.
  const price = siteCardPrice(item.payload as unknown as SiteCardPriceEvent);
  return price !== null && Number.isFinite(price) ? price : null;
}

function existingEventId(item: UploaderItem): number | null {
  if (item.event_id !== null) return item.event_id;
  const fromPayload = Number(item.payload?.id);
  if (Number.isSafeInteger(fromPayload) && fromPayload > 0) return fromPayload;
  const line = (item.decisions ?? []).find((d) => d.code === "duplicate_dropped");
  const m = line ? /#(\d+)/.exec(line.text) : null;
  return m ? Number(m[1]) : null;
}

type SupplierChip = { key: string; label: string; count: number | null; on: boolean; title: string };

/**
 * TixStock / LiveTickets as the card shows them: once built, the categories the event carries from
 * each; before that, what the supplier's catalog row says. A supplier the show does not have, or one
 * the build attached nothing from, is a dashed "✗".
 */
function supplierChips(item: UploaderItem): SupplierChip[] {
  const tickets = payloadTickets(item);
  const of = (supplier: string): number | null => (tickets ? tickets.filter((t) => t.supplier === supplier).length : null);
  const tix = item.show.suppliers?.tixstock ?? null;
  const live = item.show.suppliers?.livetickets ?? null;
  const tixCount = tickets ? of("tixstock") : (tix?.ticket_count ?? null);
  const liveCount = tickets ? of("livetickets") : (live?.sellable ?? null);
  const built = tickets !== null;
  return [
    {
      key: "tix",
      label: "Tix",
      count: tixCount,
      on: tix !== null && !(built && tixCount === 0),
      title: tix === null ? "TixStock לא מוכר את ההופעה" : built ? "קטגוריות TixStock באירוע" : "כרטיסים בקטלוג של TixStock",
    },
    {
      key: "live",
      label: "Live",
      count: liveCount,
      on: live !== null && !(built && liveCount === 0),
      title: live === null ? "LiveTickets לא מוכר את ההופעה" : built ? "קטגוריות LiveTickets באירוע" : "קטגוריות למכירה בקטלוג של LiveTickets",
    },
  ];
}

// ---- pieces -------------------------------------------------------------------------------------------

export function StatusPill({ status }: { status: ItemStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STATUS_STYLE[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status === "building" && (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-info animate-pulse motion-reduce:animate-none" />
      )}
      {ITEM_STATUS_HE[status] ?? <bdi>{status}</bdi>}
    </span>
  );
}

function SupplierChips({ item }: { item: UploaderItem }) {
  return (
    <div className="flex flex-wrap gap-1">
      {supplierChips(item).map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium",
            c.on ? "border-border bg-secondary text-foreground" : "border-dashed text-muted-foreground",
          )}
        >
          {/* One left-to-right unit, as the mockup prints it: "Tix 11", "Live ✗". */}
          <bdi dir="ltr" className="tabular-nums">
            {c.label} {c.on ? (c.count ?? "") : "✗"}
          </bdi>
        </span>
      ))}
    </div>
  );
}

/** The picture the site would draw (the subject's cut-out / crest / photo) on the forest band, with where and when over it. */
function ShowPicture({ item, art, dim }: { item: UploaderItem; art: SubjectArt; dim: boolean }) {
  const { city, venue, date } = item.show;
  const src = art?.image_url ?? null;
  return (
    <div
      className={cn(
        "relative isolate h-24 shrink-0 overflow-hidden bg-gradient-to-br from-brand-forest via-brand-forest to-sidebar-primary text-white",
        dim && "grayscale",
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "pointer-events-none absolute -z-10 select-none",
            art?.kind === "team"
              ? "end-3 top-1/2 h-16 w-16 -translate-y-1/2 object-contain opacity-90"
              : "bottom-0 end-0 h-[94%] w-[44%] object-contain object-bottom",
          )}
        />
      ) : (
        <span className="absolute end-3 top-3 inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
          <ImageOff aria-hidden className="h-3 w-3" />
          אין תמונה לנושא
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-brand-forest/90 via-brand-forest/40 to-transparent px-3.5 pb-2.5 pt-6">
        <div className={cn("truncate font-display text-[15px] font-semibold leading-tight", src && art?.kind !== "team" && "max-w-[60%]")}>
          <bdi>{city || "עיר לא ידועה"}</bdi>
        </div>
        <div className={cn("flex min-w-0 items-center gap-1.5 text-xs text-white/75", src && art?.kind !== "team" && "max-w-[60%]")}>
          {venue && (
            <>
              <bdi className="truncate">{venue}</bdi>
              <span aria-hidden className="text-white/40">
                ·
              </span>
            </>
          )}
          <span dir="ltr" className="shrink-0 tabular-nums">
            {showDate(date)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Decisions({ item }: { item: UploaderItem }) {
  const [open, setOpen] = useState(false);
  const all = item.decisions ?? [];
  if (all.length === 0) return null;
  const shown = open ? all : all.slice(0, 3);
  const more = all.length - shown.length;
  return (
    <div>
      <ul className="space-y-0.5 ps-4 text-[13px] leading-snug text-muted-foreground marker:text-muted-foreground/40">
        {shown.map((d, i) => (
          <li key={`${d.code}-${i}`} className="list-disc break-words">
            {d.text}
          </li>
        ))}
      </ul>
      {(more > 0 || open) && all.length > 3 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ms-4 mt-0.5 rounded-sm text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "פחות" : `עוד ${more}`}
        </button>
      )}
    </div>
  );
}

function FixLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 rounded-sm font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      לתקן
      <span className="sr-only"> (נפתח בלשונית חדשה)</span>
    </a>
  );
}

/** Warnings (amber) and blockers (red), each with its fix link. The far-venue warning is the offer button instead. */
function Notices({ item }: { item: UploaderItem }) {
  const warnings = (item.warnings ?? []).filter((w) => w.code !== "far_venue");
  const blockers = item.blockers ?? [];
  if (warnings.length === 0 && blockers.length === 0) return null;
  const row = (w: Warning, i: number, blocker: boolean) => (
    <li key={`${blocker ? "b" : "w"}-${w.code}-${i}`} className={cn("flex items-start gap-1.5", blocker ? "text-destructive" : "text-warning")}>
      {blocker ? (
        <Ban aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 break-words">
        {blocker && <span className="font-semibold">חוסם אישור: </span>}
        {w.text}
      </span>
      {w.fix_url && <FixLink href={w.fix_url} />}
    </li>
  );
  return (
    <ul className="space-y-1 text-[13px] leading-snug">
      {blockers.map((b, i) => row(b, i, true))}
      {warnings.map((w, i) => row(w, i, false))}
    </ul>
  );
}

/** "בנה כחבילה דרך <city> (X ק"מ) עם פיצול מלון" - wraps inside the card at any width. */
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

// ---- the shell -----------------------------------------------------------------------------------------

export type CardTone = "default" | "question" | "muted" | "error";

/**
 * The card frame every status wears: focusable (the board's ↑/↓ moves between cards), the picture
 * band, the body, an optional footer of actions. `id="item-<id>"` is the task mail's deep link.
 */
export function CardShell({
  item,
  art,
  tone,
  focused,
  onFocusCard,
  children,
  footer,
}: {
  item: UploaderItem;
  art: SubjectArt;
  tone: CardTone;
  focused: boolean;
  onFocusCard: (id: string) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article
      id={`item-${item.id}`}
      data-board-card={item.id}
      tabIndex={focused ? 0 : -1}
      aria-label={`${item.show.city} ${showDate(item.show.date)} - ${ITEM_STATUS_HE[item.status] ?? item.status}`}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusCard(item.id);
      }}
      className={cn(
        "group/card flex min-w-0 scroll-mt-24 flex-col overflow-hidden rounded-lg border bg-card shadow-card outline-none transition-shadow duration-200 ease-out",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        tone === "question" && "border-warning/70 shadow-[0_0_0_3px_hsl(var(--warning)/0.18)]",
        tone === "error" && "border-destructive/50",
        tone === "muted" && "bg-muted/40",
      )}
    >
      <ShowPicture item={item} art={art} dim={tone === "muted"} />
      <div className={cn("flex flex-1 flex-col gap-2.5 p-3.5", tone === "muted" && "text-muted-foreground")}>{children}</div>
      {footer && <footer className="flex flex-wrap items-center gap-1.5 border-t px-3.5 py-2.5">{footer}</footer>}
    </article>
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

// ---- the card --------------------------------------------------------------------------------------------

export type ShowCardProps = {
  item: UploaderItem;
  art: SubjectArt;
  subjectNameEn: string;
  edited: boolean;
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
};

const ACTION = "h-8 gap-1.5 px-2.5 text-[13px] [&_svg]:size-3.5";

function EditLink({ eventId, label = "ערוך" }: { eventId: number; label?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={ACTION}>
      <a href={`/events/${eventId}`} target="_blank" rel="noreferrer">
        <SquarePen aria-hidden />
        {label}
        <span className="sr-only"> (נפתח בלשונית חדשה)</span>
      </a>
    </Button>
  );
}

function RejectButton({ item, busy, onReject }: { item: UploaderItem; busy: BusyKind | null; onReject: (item: UploaderItem) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy !== null}
      onClick={() => onReject(item)}
      className={cn(ACTION, "text-destructive hover:bg-destructive/10 hover:text-destructive")}
    >
      <X aria-hidden />
      דחה
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

export function ShowCard(props: ShowCardProps) {
  const { item, art, subjectNameEn, edited, people, busy, focused, now, onFocusCard, onApprove, onReject, onRetry, onRebuild } = props;
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
          <Notices item={item} />
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
          <Decisions item={item} />
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
      const reason = item.skip_reason ? (SKIP_REASON_HE[item.skip_reason] ?? item.skip_reason) : "לא ידוע";
      const existing = item.skip_reason === "exists" ? existingEventId(item) : null;
      const fallback = item.show.fallback ?? [];
      return shell(
        "muted",
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status="skipped" />
          </div>
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
          <Decisions item={item} />
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
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status="error" />
          </div>
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
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => onRetry(item)} className={ACTION}>
            {busy === "retry" ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCw aria-hidden />}
            נסה שוב
          </Button>
          <RejectButton item={item} busy={busy} onReject={onReject} />
        </>,
      );

    case "building": {
      const stale = isStaleBuild(item.updated_at, now);
      return shell(
        stale ? "error" : "default",
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status="building" />
          </div>
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
        stale ? (
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => onRetry(item)} className={ACTION}>
            {busy === "retry" ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCw aria-hidden />}
            נסה שוב
          </Button>
        ) : undefined,
      );
    }

    case "found":
      return shell(
        "default",
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status="found" />
          </div>
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
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={item.status} />
          </div>
          <SupplierChips item={item} />
          <Decisions item={item} />
        </>,
      );
  }
}
