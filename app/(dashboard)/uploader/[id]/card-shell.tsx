"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Ban, ImageOff, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubjectArt } from "@/lib/uploader/action-types";
import { cardWarnings } from "@/lib/uploader/run-panel";
import { cn } from "@/lib/utils";
import type { ItemStatus, UploaderItem, Warning } from "@/types/uploader.types";
import { farVenueTarget, FOLD_LINE, ITEM_STATUS_HE, showDate, supplierChips, supplierChipText, type BusyKind } from "./board-words";

// The frame every card on the review board wears (spec §5.3, mockup B): focusable, the picture the
// site would draw with where and when over it, a body, a footer of actions - and the pieces every
// card body shares (status pill, supplier chips, decisions, warnings / blockers, reject button).
// The show card and the question card both build on it.

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

/** The size every card action button wears - wraps at any width, never overflows. */
export const ACTION = "h-8 gap-1.5 px-2.5 text-[13px] [&_svg]:size-3.5";

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

export function RejectButton({ item, busy, onReject }: { item: UploaderItem; busy: BusyKind | null; onReject: (item: UploaderItem) => void }) {
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

/** The picture the site would draw (the subject's cut-out / crest / photo) on the forest band, with where and when over it. */
function ShowPicture({ item, art, dim }: { item: UploaderItem; art: SubjectArt; dim: boolean }) {
  const { city, venue, date } = item.show;
  const src = art?.image_url ?? null;
  const narrow = src !== null && art?.kind !== "team";
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
        <div className={cn("truncate font-display text-[15px] font-semibold leading-tight", narrow && "max-w-[60%]")}>
          <bdi>{city || "עיר לא ידועה"}</bdi>
        </div>
        <div className={cn("flex min-w-0 items-center gap-1.5 text-xs text-white/75", narrow && "max-w-[60%]")}>
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

export type CardTone = "default" | "question" | "muted" | "error";

/**
 * The card frame every status wears: focusable (the board's ↑/↓ moves between cards; `focused` =
 * the one card Tab lands on), the picture band, the body, an optional footer of actions.
 * `id="item-<id>"` is the task mail's deep link.
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

// ---- pieces every card body shares ----------------------------------------------------------------------

export function SupplierChips({ item }: { item: UploaderItem }) {
  return (
    <div className="flex flex-wrap gap-1">
      {supplierChips(item).map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-px text-[11px] font-medium",
            c.on ? "border-border bg-secondary text-foreground" : "border-dashed text-muted-foreground",
          )}
        >
          {/* One left-to-right unit, as the mockup prints it: "Tix 11", "Live ✗". */}
          <bdi dir="ltr" className="tabular-nums">
            {supplierChipText(c)}
          </bdi>
        </span>
      ))}
    </div>
  );
}

export function Decisions({ item, hide }: { item: UploaderItem; hide?: string }) {
  const [open, setOpen] = useState(false);
  const all = (item.decisions ?? []).filter((d) => d.code !== hide);
  if (all.length === 0) return null;
  const shown = open ? all : all.slice(0, 3);
  return (
    <div>
      <ul className="space-y-0.5 ps-4 text-[13px] leading-snug text-muted-foreground marker:text-muted-foreground/40">
        {shown.map((d, i) => (
          <li key={`${d.code}-${i}`} className="list-disc break-words">
            {d.text}
          </li>
        ))}
      </ul>
      {all.length > 3 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ms-4 mt-0.5 rounded-sm text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "פחות" : `עוד ${all.length - 3}`}
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

/** Brings the run panel into view and focus (a card's folded line). */
function goToRunPanel() {
  const panel = document.getElementById("run-panel");
  if (!panel) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  panel.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  panel.focus({ preventScroll: true });
}

/**
 * Warnings (amber) and blockers (red), each with its fix link. The far-venue warning becomes the
 * offer button when the card can make the offer; otherwise it is printed like any other warning.
 * `fold` (the run panel is on screen, spec 5.1): the run-level warnings (`cardWarnings`) leave the card
 * for one grey line that jumps to the panel - a view only, the stored warnings are untouched.
 */
export function Notices({ item, fold = false }: { item: UploaderItem; fold?: boolean }) {
  const offer = farVenueTarget(item) !== null;
  const { card, folded } = fold ? cardWarnings({ ...item, warnings: item.warnings ?? [] }) : { card: item.warnings ?? [], folded: 0 };
  const warnings = card.filter((w) => !(offer && w.code === "far_venue"));
  const blockers = item.blockers ?? [];
  if (warnings.length === 0 && blockers.length === 0 && folded === 0) return null;
  const row = (w: Warning, i: number, blocker: boolean) => (
    <li key={`${blocker ? "b" : "w"}-${w.code}-${i}`} className={cn("flex items-start gap-1.5", blocker ? "text-destructive" : "text-warning")}>
      {blocker ? <Ban aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
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
      {folded > 0 && (
        <li>
          <button
            type="button"
            onClick={goToRunPanel}
            className="flex items-start gap-1.5 rounded-sm text-start text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {FOLD_LINE(folded)}
          </button>
        </li>
      )}
    </ul>
  );
}
