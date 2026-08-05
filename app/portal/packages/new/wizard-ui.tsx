"use client";

/**
 * The wizard's chrome, ported from myt-main's order flow so the agent gets the
 * exact experience customers get on the site:
 *  - Stepper           ← components/ui/Stepper.tsx (Mantine there; hand-rolled here)
 *  - CardWrapper       ← components/ui/cardWrapper.tsx (the one card look of all steps)
 *  - ContinueBar       ← app/order/OrderContinueBar.tsx (slots + count-up total + CTA)
 *  - SortTabs          ← FlightSelection/HotelSelection sort tab row
 *  - price-delta labels← the site's "כלול במחיר / תוספת לכל נוסע" convention (±$4)
 *
 * Main's `forest`/`glow` tokens map to this app's `brand-forest`/`brand-mint`.
 */

import React, { useEffect, useRef, useState } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

export const usd = (value: number) => `$${Math.ceil(value).toLocaleString("en-US")}`;

export const dateFmt = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("he-IL") : "";

export const timeFmt = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : "";

export const dateOnly = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");

/** "PT4H5M" → "4h 05" — main's duration label. */
export const durationLabel = (value: string | null | undefined) => {
  const match = value?.match(/PT(\d+)H(\d*)M?/);
  if (!match) return "";
  return match[2] ? `${match[1]}h ${match[2].padStart(2, "0")}` : `${match[1]}h`;
};

/** Minutes → "4h 05" for live offers, where only timestamps exist. */
export const minutesLabel = (minutes: number | null) => {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, "0")}` : `${h}h`;
};

/**
 * Main treats a component within ±$4 of the package baseline as included
 * (order-review.utils.ts priceOutsidePackBoundaries).
 */
export const INCLUDED_BAND = 4;

export type Delta =
  | { kind: "included" }
  | { kind: "delta"; amount: number }
  | { kind: "absolute"; amount: number };

/** Delta vs a package baseline; absolute price when no baseline exists. */
export function deltaVsBase(perPerson: number, base: number | null | undefined): Delta {
  if (base == null || !Number.isFinite(base) || base <= 0) {
    return { kind: "absolute", amount: perPerson };
  }
  const diff = Math.ceil(perPerson - base);
  if (Math.abs(diff) <= INCLUDED_BAND) return { kind: "included" };
  return { kind: "delta", amount: diff };
}

/** Slot-pill note: `+$120` / `-$45` / `כלול` (main's priceNote). */
export function deltaNote(delta: Delta): string {
  if (delta.kind === "included") return "כלול";
  if (delta.kind === "absolute") return usd(delta.amount);
  return delta.amount > 0 ? `+${usd(delta.amount)}` : `-${usd(Math.abs(delta.amount))}`;
}

/** The delta a Delta contributes to the per-person running total. */
export const deltaAmount = (delta: Delta): number =>
  delta.kind === "delta" ? delta.amount : delta.kind === "absolute" ? delta.amount : 0;

/**
 * Main's price column: big ± number with a "תוספת/חסכון לכל נוסע" caption, or
 * "כלול במחיר" (FlightCard.tsx / hotelCard.tsx price columns).
 */
export function DeltaPrice({
  delta,
  per,
  className,
}: {
  delta: Delta;
  /** "נוסע" / "כרטיס" / "אורח" */
  per: string;
  className?: string;
}) {
  if (delta.kind === "included") {
    return <span className={cn("text-xl font-bold", className)}>כלול במחיר</span>;
  }
  if (delta.kind === "absolute") {
    return (
      <span className={cn("flex flex-col items-center font-bold", className)}>
        <span className="text-lg tabular-nums lg:text-2xl" dir="ltr">
          {usd(delta.amount)}
        </span>
        <span className="whitespace-nowrap text-sm">ל{per}</span>
      </span>
    );
  }
  const saving = delta.amount < 0;
  return (
    <span className={cn("flex flex-col items-center font-bold", className)}>
      <span className="text-lg tabular-nums lg:text-2xl" dir="ltr">
        {saving ? "-" : "+"}${Math.abs(delta.amount).toLocaleString("en-US")}
      </span>
      <span className="whitespace-nowrap text-sm">
        {saving ? `חסכון לכל ${per}!` : `תוספת לכל ${per}`}
      </span>
    </span>
  );
}

/** Mobile price pill pinned to the card's top edge (main's FlightCard/hotelCard). */
export function MobileDeltaPill({ delta, per, selected }: { delta: Delta; per: string; selected: boolean }) {
  const text =
    delta.kind === "included"
      ? "כלול במחיר"
      : delta.kind === "absolute"
        ? `${usd(delta.amount)} ל${per}`
        : delta.amount > 0
          ? `תוספת ${usd(delta.amount)} ל${per}`
          : `הפחיתו ${usd(Math.abs(delta.amount))} ל${per}`;
  return (
    <span
      className={cn(
        "absolute right-2 top-0 z-10 -translate-y-1/2 whitespace-nowrap rounded-2xl border px-3 py-1 text-sm font-bold lg:hidden",
        selected
          ? "border-brand-forest bg-brand-forest text-white dark:border-brand-mint dark:bg-brand-mint dark:text-brand-forest"
          : "border-brand-forest bg-card text-brand-forest dark:border-brand-mint dark:text-brand-mint",
      )}
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  CardWrapper — main's shared selectable card                        */
/* ------------------------------------------------------------------ */

export function CardWrapper({
  isSelected,
  onClick,
  disabled,
  className,
  children,
}: {
  isSelected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      dir="rtl"
      role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        onClick && !disabled
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{ WebkitTapHighlightColor: "transparent" }}
      className={cn(
        "relative flex cursor-pointer flex-row items-center justify-between rounded-lg border-2 border-border bg-card px-4 py-2 text-card-foreground shadow-lg transition-shadow",
        "hover:shadow-xl hover:outline hover:outline-2 hover:outline-offset-[-2px] hover:outline-brand-forest",
        "focus-visible:outline-none",
        isSelected &&
          "border-brand-forest bg-brand-mint/10 dark:border-brand-mint dark:bg-brand-mint/10",
        disabled &&
          "cursor-not-allowed border-border bg-muted opacity-60 shadow-none grayscale hover:shadow-none hover:outline-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The amber "promoted" pill main pins on offline inventory (hotelCard.tsx). */
export function PromotedPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700",
        className,
      )}
    >
      ★ מהמלאי המובטח שלנו
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Stepper — main's top progress bar                                  */
/* ------------------------------------------------------------------ */

export function WizardStepper({
  steps,
  current,
  onStepClick,
  locked,
}: {
  steps: readonly string[];
  current: number;
  /** Backward navigation only — like main's Stepper. */
  onStepClick: (index: number) => void;
  /** Edit-from-summary mode blocks stepper jumps (main's returnToSummary). */
  locked?: boolean;
}) {
  return (
    <div className="border-b border-border pb-3">
      <ol className="flex flex-nowrap items-center justify-between gap-1 sm:justify-start sm:gap-0">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const clickable = !locked && done;
          return (
            <li key={label} className="flex min-w-0 items-center sm:flex-1 sm:last:flex-none">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepClick(i)}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-2",
                  clickable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold transition-colors sm:h-8 sm:w-8 sm:text-sm",
                    done && "border-transparent bg-brand-mint text-brand-forest",
                    active &&
                      "border-brand-forest bg-background text-brand-forest dark:border-brand-mint dark:text-brand-mint",
                    !done && !active && "border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-[13px] font-bold sm:text-[15px]",
                    active ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span className="mx-2 hidden h-px flex-1 bg-border sm:block" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ContinueBar — main's sticky bottom bar                             */
/* ------------------------------------------------------------------ */

/** rAF count-up with main's cubic ease-out (OrderContinueBar useCountUp). */
function useCountUp(target: number, duration = 520) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

const ACCENT_FG = "text-brand-forest dark:text-brand-mint";

export interface ContinueSlot {
  key: string;
  icon: LucideIcon;
  label: string;
  /** null → the dashed "not chosen yet" state. */
  value: string | null;
  /** "· +$120" style note after the value. */
  note?: string | null;
  /** Step index to jump to when clicked; null → not navigable. */
  target: number | null;
}

export interface ContinueSecondaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ContinueBar({
  slots,
  totalPerPerson,
  qty,
  onSlotClick,
  primaryLabel,
  primaryDisabled,
  onPrimary,
  secondaryActions,
  building,
}: {
  slots: ContinueSlot[];
  totalPerPerson: number | null;
  /** Travellers — the live number is the FULL payment (qty × per person),
   *  exactly like main's order summary, with the per-person beside it. */
  qty: number;
  onSlotClick: (target: number) => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  /** Up to two compact shortcuts stacked one above the other beside the
   *  primary CTA — each answers the NEXT step's question and skips past it. */
  secondaryActions?: ContinueSecondaryAction[] | null;
  /** Final-step build animation (main's "מרכיבים את החבילה…"). */
  building?: boolean;
}) {
  const totalPkg =
    totalPerPerson != null ? totalPerPerson * Math.max(1, qty) : null;
  const animated = useCountUp(Math.max(0, Math.ceil(totalPkg ?? 0)));
  const [buildDone, setBuildDone] = useState(false);
  useEffect(() => {
    if (!building) {
      setBuildDone(false);
      return;
    }
    const t = window.setTimeout(() => setBuildDone(true), 1700);
    return () => window.clearTimeout(t);
  }, [building]);

  return (
    <div className="sticky bottom-0 z-40 -mx-2 border-t border-border bg-background/85 px-2 backdrop-blur sm:mx-0 sm:px-0">
      <style>{`@keyframes ocb-pop { from { opacity: 0; transform: scale(.4);} to { opacity: 1; transform: scale(1);} }`}</style>
      <div dir="rtl" className="mx-auto w-full max-w-5xl px-0 py-2 sm:py-1.5">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_44px_-24px_rgba(10,26,20,.35)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 sm:px-3 sm:py-2">
            {/* Slot pills (hidden entirely in edit-from-summary mode) */}
            {slots.length > 0 && (
              <div className="flex gap-2 border-b border-border bg-muted/40 px-3 py-2 sm:min-w-0 sm:flex-1 sm:border-b-0 sm:bg-transparent sm:p-0">
                {slots.map((slot) => {
                  const filled = slot.value != null;
                  const clickable = slot.target != null;
                  const Tag = clickable ? "button" : "div";
                  const Icon = slot.icon;
                  return (
                    <Tag
                      key={slot.key}
                      type={clickable ? "button" : undefined}
                      onClick={clickable ? () => onSlotClick(slot.target!) : undefined}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-xl border-[1.5px] px-2.5 py-2 text-right transition-colors duration-300",
                        filled
                          ? "border-brand-forest/70 bg-brand-mint/[0.13] dark:border-brand-mint/60"
                          : "border-dashed border-border bg-card",
                        clickable &&
                          "cursor-pointer hover:border-brand-forest hover:bg-brand-mint/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] dark:hover:border-brand-mint",
                      )}
                    >
                      <span className={cn("shrink-0", ACCENT_FG)}>
                        <Icon size={17} strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-[11px] font-semibold text-muted-foreground",
                            filled && "text-[9.5px]",
                          )}
                        >
                          {slot.label}
                        </span>
                        {filled && (
                          <span className={cn("block truncate text-[11.5px] font-bold", ACCENT_FG)}>
                            {slot.value}
                            {slot.note && (
                              <span className="mr-1 font-semibold text-muted-foreground">
                                · {slot.note}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      {filled && (
                        <span
                          className={cn("mr-auto", ACCENT_FG)}
                          style={{ animation: "ocb-pop .3s ease both" }}
                        >
                          <Check size={16} strokeWidth={2.6} />
                        </span>
                      )}
                    </Tag>
                  );
                })}
              </div>
            )}

            {/* Price + actions */}
            <div className="flex flex-col gap-2 px-4 py-2.5 sm:contents">
              {totalPkg != null && (
                <div className={cn("flex items-baseline gap-1 sm:shrink-0", ACCENT_FG)}>
                  <span className="text-[15px] font-bold">$</span>
                  <span className="text-[23px] font-extrabold leading-none tracking-tight tabular-nums">
                    {animated.toLocaleString("en-US")}
                  </span>
                  <span className="mr-1 text-xs font-semibold text-muted-foreground">
                    סה&quot;כ
                    {qty > 1 && totalPerPerson != null && (
                      <>
                        {" "}
                        <span dir="ltr" className="tabular-nums">
                          (${Math.ceil(totalPerPerson).toLocaleString("en-US")}
                        </span>{" "}
                        לנוסע)
                      </>
                    )}
                  </span>
                </div>
              )}

              {building ? (
                <div className="flex min-w-56 flex-1 flex-col gap-1.5 sm:flex-none">
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full transition-[width] duration-[1800ms] ease-out"
                      style={{ width: "100%", background: "hsl(var(--brand-mint))" }}
                    />
                  </div>
                  <span className={cn("text-center text-[13px] font-extrabold", ACCENT_FG)}>
                    {buildDone ? "✓ החבילה מוכנה!" : "מרכיבים את החבילה…"}
                  </span>
                </div>
              ) : (
                <div className="flex items-stretch gap-2 sm:shrink-0">
                  {secondaryActions && secondaryActions.length > 0 && (
                    <div className="flex flex-1 flex-col justify-center gap-1 sm:flex-none">
                      {secondaryActions.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          disabled={action.disabled}
                          onClick={action.onClick}
                          className={cn(
                            "whitespace-nowrap rounded-lg border-[1.5px] border-brand-forest px-3 py-1 text-[12px] font-bold leading-tight text-brand-forest transition-colors dark:border-brand-mint dark:text-brand-mint",
                            action.disabled
                              ? "cursor-not-allowed opacity-40"
                              : "hover:bg-brand-forest/5 dark:hover:bg-brand-mint/10",
                          )}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={primaryDisabled}
                    onClick={onPrimary}
                    className={cn(
                      "flex-[1.4] whitespace-nowrap rounded-md bg-brand-forest px-5 py-2.5 text-xs font-semibold text-white transition-all dark:bg-brand-mint dark:text-brand-forest sm:flex-none sm:px-4",
                      secondaryActions && secondaryActions.length > 0
                        ? "sm:self-stretch"
                        : "sm:py-1.5",
                      primaryDisabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:-translate-y-px hover:shadow-[0_12px_26px_-12px_rgba(10,26,20,.55)]",
                    )}
                  >
                    {primaryLabel}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sort tabs — main's 3-card (desktop) / 3-pill (mobile) sort row     */
/* ------------------------------------------------------------------ */

export interface SortTabOption<K extends string> {
  key: K;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export function SortTabs<K extends string>({
  options,
  active,
  onChange,
}: {
  options: SortTabOption<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <>
      {/* Desktop: 3 cards */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-3" role="tablist">
        {options.map((option) => {
          const isActive = option.key === active;
          const Icon = option.icon;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(option.key)}
              className={cn(
                "flex items-center gap-3 rounded-md border-[1.5px] px-4 py-3 text-right outline-none transition-colors",
                isActive
                  ? "border-brand-forest bg-brand-forest/10 dark:border-brand-mint/40"
                  : "border-border bg-card hover:border-brand-forest",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                  isActive ? "bg-brand-forest dark:bg-brand-mint" : "bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-colors",
                    isActive
                      ? "text-white dark:text-brand-forest"
                      : "text-muted-foreground",
                  )}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="text-sm font-bold text-foreground">{option.title}</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground">{option.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
      {/* Mobile: pill group */}
      <div className="flex min-w-0 flex-1 gap-[2px] rounded-md border border-border bg-card p-[3px] lg:hidden">
        {options.map((option) => {
          const isActive = option.key === active;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded px-1 py-2 leading-tight transition-colors",
                isActive ? "bg-brand-forest dark:bg-brand-mint" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "whitespace-nowrap text-[11px] font-bold",
                  isActive ? "text-white dark:text-brand-forest" : "text-foreground",
                )}
              >
                {option.title}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Misc shared pieces                                                 */
/* ------------------------------------------------------------------ */

/** Event header band — main's EventDataHeader (round photo + name + date | location). */
export function EventBand({
  name,
  date,
  location,
  imageUrl,
  children,
}: {
  name: string;
  date: string | null;
  location: string;
  imageUrl: string | null;
  /** Extra controls (search fields) laid beside the header, like main. */
  children?: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="rounded-2xl bg-muted px-4 py-3 lg:px-6 lg:py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full flex-row items-center gap-4 lg:w-[34%]">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="size-14 shrink-0 rounded-full border-2 border-white object-cover object-top shadow-md md:size-20"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-xl font-bold leading-tight md:text-3xl">{name}</p>
            <p className="mt-0.5 text-sm md:text-xl">
              {[dateFmt(date), location].filter(Boolean).join(" | ")}
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Empty/error card — main's OrderIssueState, lite. */
export function IssueState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-6 text-center">
      <p className="font-bold">{title}</p>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      {action}
    </div>
  );
}

/** Dashed "extra option" row — main's summary "+ להוספה" pattern. */
export function DashedOptionRow({
  icon: Icon,
  title,
  subtitle,
  chip,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  chip?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-xl border border-dashed px-3 py-2.5 text-right transition-colors",
        selected
          ? "border-brand-forest bg-brand-mint/10 dark:border-brand-mint"
          : "border-border hover:border-brand-forest hover:bg-brand-forest/5 dark:hover:border-brand-mint dark:hover:bg-brand-mint/10",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cn("text-[16px]", ACCENT_FG)}>
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-foreground">{title}</span>
          {subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
          )}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-lg border px-2.5 py-1 text-[12px] font-bold",
          selected
            ? "border-brand-forest bg-brand-forest text-white dark:border-brand-mint dark:bg-brand-mint dark:text-brand-forest"
            : "border-brand-forest text-brand-forest dark:border-brand-mint dark:text-brand-mint",
        )}
      >
        {selected ? "✓ נבחר" : chip ?? "+ לבחירה"}
      </span>
    </button>
  );
}
