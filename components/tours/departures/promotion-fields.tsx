"use client";

/**
 * The fields of one promotion. Used by the card's promotions tab (add / edit)
 * and by the board's "add a promotion to the selected departures".
 */
import { Input } from "@/components/ui/input";
import { PROMOTION_KINDS, PROMOTION_KIND_LABELS, type PromotionKind } from "@/types/tours.types";
import { currencySymbol } from "./departure-utils";
import type { PromotionInput } from "./types";
import { Field, selectClass } from "./ui-bits";

export interface PromotionDraft {
  kind: PromotionKind;
  value: string;
  label: string;
  valid_until: string;
  show_on_card: boolean;
  is_active: boolean;
}

export const emptyPromotionDraft = (): PromotionDraft => ({
  kind: "fixed_per_pax",
  value: "",
  label: "",
  valid_until: "",
  show_on_card: true,
  is_active: true,
});

export const draftToInput = (d: PromotionDraft): PromotionInput => ({
  kind: d.kind,
  value: d.value.trim() === "" ? null : Number(d.value),
  label: d.label.trim() || null,
  valid_until: d.valid_until || null,
  show_on_card: d.show_on_card,
  is_active: d.is_active,
});

const VALUE_HINT: Record<PromotionKind, string> = {
  percent_order: "Percent of the order total",
  fixed_per_pax: "Amount per traveler, in the departure currency",
  fixed_per_order: "Amount per order, in the departure currency",
  named_per_pax: "Amount per traveler, in the departure currency",
  gift: "No money value - text only",
};

export function PromotionFields({
  draft,
  onChange,
  currency,
  kindLocked,
}: {
  draft: PromotionDraft;
  onChange: (next: PromotionDraft) => void;
  /** Currency of the departure, or null when the selection mixes currencies. */
  currency: string | null;
  kindLocked?: boolean;
}) {
  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => onChange({ ...draft, [key]: value });
  const isGift = draft.kind === "gift";
  const unit = draft.kind === "percent_order" ? "%" : currencySymbol(currency) || "amount";
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Promotion type" className="col-span-2">
        <select
          aria-label="Promotion type"
          className={`${selectClass} w-full`}
          value={draft.kind}
          disabled={kindLocked}
          onChange={(e) => set("kind", e.target.value as PromotionKind)}
        >
          {PROMOTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {PROMOTION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
      {!isGift && (
        <Field label={`Value (${unit})`} hint={VALUE_HINT[draft.kind]}>
          <Input
            dir="ltr"
            inputMode="decimal"
            aria-label="Promotion value"
            className="h-9 text-end"
            value={draft.value}
            onChange={(e) => set("value", e.target.value)}
            placeholder={draft.kind === "percent_order" ? "10" : "80"}
          />
        </Field>
      )}
      <Field
        label={isGift ? "Gift" : draft.kind === "named_per_pax" ? "Discount name" : "Text (optional)"}
        className={isGift ? "col-span-2" : undefined}
        hint={isGift ? "Shown above the date picker on the site" : undefined}
      >
        <Input dir="auto" className="h-9" value={draft.label} onChange={(e) => set("label", e.target.value)} />
      </Field>
      <Field label="Valid until" hint="Empty = no expiry date">
        <Input
          dir="ltr"
          type="date"
          className="h-9"
          value={draft.valid_until}
          onChange={(e) => set("valid_until", e.target.value)}
        />
      </Field>
      <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            checked={draft.show_on_card}
            onChange={(e) => set("show_on_card", e.target.checked)}
          />
          Show on the date card
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            checked={draft.is_active}
            onChange={(e) => set("is_active", e.target.checked)}
          />
          Active
        </label>
      </div>
    </div>
  );
}

/** Client-side check before the server's: catches the obvious so the dialog can say it at once. */
export function promotionDraftError(d: PromotionDraft): string | null {
  if (d.kind === "gift") return d.label.trim() ? null : "A gift needs text that describes it";
  const value = Number(d.value);
  if (d.value.trim() === "" || !Number.isFinite(value) || value <= 0) return "The promotion value must be a number greater than zero";
  if (d.kind === "percent_order" && value > 100) return "A percent discount can't exceed 100";
  if (d.kind === "named_per_pax" && !d.label.trim()) return "A named discount needs a name";
  return null;
}
