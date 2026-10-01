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

const RLM = "‏";

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
    toast.success(editing === "new" ? "ההטבה נוספה" : "ההטבה עודכנה");
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
    toast.success(next ? "ההטבה הופעלה" : "ההטבה כובתה");
    await onSaved();
  };

  const remove = async (p: CardPromotion) => {
    const agreed = await confirm({
      title: `למחוק את ההטבה?${RLM}`,
      description: `${promotionSummary(p, d.currency)}. כדי להפסיק הטבה בלי למחוק אותה אפשר פשוט לכבות אותה.${RLM}`,
      confirmLabel: "מחיקה",
      cancelLabel: "ביטול",
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
    toast.success("ההטבה נמחקה");
    await onSaved();
  };

  const form = (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <PromotionFields draft={draft} onChange={setDraft} currency={d.currency} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-destructive">{draft.value || draft.label ? error : ""}</span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={busy === "form"}>
            ביטול
          </Button>
          <Button size="sm" onClick={submit} disabled={busy === "form" || Boolean(error)}>
            {busy === "form" && <Loader2 className="animate-spin" />}
            {editing === "new" ? "הוספת ההטבה" : "שמירה"}
          </Button>
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          ההטבות חלות אוטומטית על כל הזמנה ליציאה הזו. הנחת אחוז מההזמנה והנחה בסכום קבוע לנוסע לא פעילות יחד.
        </p>
        {!readOnly && editing !== "new" && (
          <Button size="sm" variant="outline" onClick={() => open(null)}>
            <Plus />
            הטבה חדשה
          </Button>
        )}
      </div>

      {editing === "new" && form}

      {data.promotions.length === 0 && editing !== "new" ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">אין הטבות ליציאה הזו.</p>
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
                  <Chip className="border-info/30 bg-info-muted text-info">מהסדרה</Chip>
                ) : busy === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Toggle
                    size="sm"
                    checked={p.is_active}
                    disabled={readOnly}
                    label={p.is_active ? "פעילה - לחצו לכיבוי" : "כבויה - לחצו להפעלה"}
                    onChange={(next) => toggle(p, next)}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{promotionSummary(p, d.currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    {PROMOTION_KIND_LABELS[p.kind as PromotionKind] ?? p.kind}
                    {p.valid_until ? ` · בתוקף עד ${fmtDate(p.valid_until)}` : " · בלי תאריך תפוגה"}
                    {p.show_on_card ? " · מוצגת על הכרטיס" : ""}
                  </p>
                </div>
                {expired && p.is_active && (
                  <Chip className="border-warning/40 bg-warning-muted text-warning" title="האתר ממשיך להציג הטבה פעילה גם אחרי תאריך התפוגה. כבו אותה כדי להפסיק.">
                    פג תוקף, עדיין פעילה
                  </Chip>
                )}
                {!p.is_active && <Chip>כבויה</Chip>}
                {!fromSeries && !readOnly && (
                  <span className="flex items-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="עריכה" onClick={() => open(p)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title="מחיקה"
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
          הטבה שמסומנת &quot;מהסדרה&quot; חלה על כל היציאות של הסדרה ונערכת ברמת הסדרה.
        </Notice>
      )}
    </div>
  );
}
