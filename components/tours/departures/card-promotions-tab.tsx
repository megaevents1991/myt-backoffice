"use client";

/**
 * Card tab "הטבות": the promotions of one departure - list, add, edit, switch
 * off, delete. Promotions set on the series show here read-only. The either/or
 * rule (percent of the order vs fixed amount per passenger) is enforced by the
 * server action; this tab only repeats its message.
 */
import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { cn } from "@/lib/utils";
import { PROMOTION_KIND_LABELS, type PromotionKind } from "@/types/tours.types";
import { deletePromotion, savePromotion, setPromotionActive } from "@/lib/actions/tours-departure-actions";
import { fmtDate, isExpired, promotionSummary } from "./departure-utils";
import {
  PromotionFields,
  draftToInput,
  emptyPromotionDraft,
  promotionDraftError,
  type PromotionDraft,
} from "./promotion-fields";
import type { CardPromotion, DepartureCardData } from "./types";
import { Chip, Notice, Toggle } from "./ui-bits";

const toDraft = (p: CardPromotion): PromotionDraft => ({
  kind: p.kind as PromotionKind,
  value: p.value == null ? "" : String(p.value),
  label: p.label ?? "",
  valid_until: p.valid_until ?? "",
  show_on_card: p.show_on_card,
  is_active: p.is_active,
});

export function CardPromotionsTab({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const confirm = useConfirm();
  /** "new" = the add form, an id = editing that promotion, null = nothing open. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromotionDraft>(emptyPromotionDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const readOnly = Boolean(d.is_deleted);
  const error = promotionDraftError(draft);

  const open = (promotion: CardPromotion | null) => {
    setDraft(promotion ? toDraft(promotion) : emptyPromotionDraft());
    setEditing(promotion ? promotion.id : "new");
  };

  const submit = async () => {
    setBusy("form");
    const result = await savePromotion(d.id, editing === "new" ? null : editing, draftToInput(draft));
    setBusy(null);
    if (!result.success) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(editing === "new" ? "Promotion added" : "Promotion updated");
    setEditing(null);
    await onSaved();
  };

  const toggle = async (p: CardPromotion, next: boolean) => {
    setBusy(p.id);
    const result = await setPromotionActive(p.id, next);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(next ? "Promotion switched on" : "Promotion switched off");
    await onSaved();
  };

  const remove = async (p: CardPromotion) => {
    const agreed = await confirm({
      title: "Delete this promotion?",
      description: `${promotionSummary(p, d.currency)}. To stop a promotion without deleting it, just switch it off.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!agreed) return;
    setBusy(p.id);
    const result = await deletePromotion(p.id);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Promotion deleted");
    await onSaved();
  };

  const form = (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <PromotionFields draft={draft} onChange={setDraft} currency={d.currency} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-destructive">{draft.value || draft.label ? error : ""}</span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={busy === "form"}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy === "form" || Boolean(error)}>
            {busy === "form" && <Loader2 className="animate-spin" />}
            {editing === "new" ? "Add Promotion" : "Save Changes"}
          </Button>
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Promotions apply automatically to every booking on this departure. A percent-off-the-order discount and a fixed discount per traveler can&apos;t be active together.
        </p>
        {!readOnly && editing !== "new" && (
          <Button size="sm" variant="outline" onClick={() => open(null)}>
            <Plus />
            New Promotion
          </Button>
        )}
      </div>

      {editing === "new" && form}

      {data.promotions.length === 0 && editing !== "new" ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No promotions on this departure.</p>
      ) : (
        <ul className="space-y-2">
          {data.promotions.map((p) => {
            const fromSeries = !p.departure_id;
            const expired = isExpired(p.valid_until);
            if (editing === p.id) return <li key={p.id}>{form}</li>;
            return (
              <li
                key={p.id}
                data-promotion-kind={p.kind}
                className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2", !p.is_active && "bg-muted/40 text-muted-foreground")}
              >
                {fromSeries ? (
                  <Chip className="border-info/30 bg-info-muted text-info">From series</Chip>
                ) : busy === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Toggle
                    size="sm"
                    checked={p.is_active}
                    disabled={readOnly}
                    label={p.is_active ? "Active - click to switch off" : "Off - click to switch on"}
                    onChange={(next) => toggle(p, next)}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{promotionSummary(p, d.currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    {PROMOTION_KIND_LABELS[p.kind as PromotionKind] ?? p.kind}
                    {p.valid_until ? ` · Valid until ${fmtDate(p.valid_until)}` : " · No expiry date"}
                    {p.show_on_card ? " · Shown on the date card" : ""}
                  </p>
                </div>
                {expired && p.is_active && (
                  <Chip className="border-warning/40 bg-warning-muted text-warning" title="The site keeps showing an active promotion after its expiry date. Switch it off to stop it.">
                    Expired, still active
                  </Chip>
                )}
                {!p.is_active && <Chip>Off</Chip>}
                {!fromSeries && !readOnly && (
                  <span className="flex items-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => open(p)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title="Delete"
                      disabled={busy === p.id}
                      onClick={() => remove(p)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.promotions.some((p) => !p.departure_id) && (
        <Notice tone="info" className="text-xs">
          A promotion marked &quot;From series&quot; applies to every departure of the series and is edited on the series.
        </Notice>
      )}
    </div>
  );
}
