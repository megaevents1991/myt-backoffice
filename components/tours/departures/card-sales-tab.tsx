"use client";

/**
 * Card tab "מכירות": seats sold outside MYT, typed in by operations until the
 * reservations move in. Sold = the sum of the entries; remaining = seats of the
 * live flight blocks minus sold. A negative remainder is allowed and shown red.
 */
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-provider";
import { cn } from "@/lib/utils";
import { addSalesEntry, deleteSalesEntry } from "@/lib/actions/tours-departure-actions";
import { fmtInstant } from "./departure-utils";
import type { CardSalesEntry, DepartureCardData } from "./types";
import { Field, Ltr, Notice } from "./ui-bits";

const RLM = "‏";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "muted" }) {
  return (
    <div className="rounded-md border px-3 py-2 text-center">
      <div
        data-stat={label}
        className={cn("font-display text-2xl font-bold tabular-nums", tone === "bad" && "text-destructive", tone === "muted" && "text-muted-foreground")}
      >
        <Ltr>{value}</Ltr>
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function CardSalesTab({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const confirm = useConfirm();
  const [pax, setPax] = useState("");
  const [docket, setDocket] = useState(d.docket_no ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const readOnly = Boolean(d.is_deleted);
  const paxNumber = Number(pax);
  const paxValid = pax.trim() !== "" && Number.isInteger(paxNumber) && paxNumber !== 0;
  const { allocated, sold, remaining, liveBlocks } = data.stats;

  const add = async () => {
    setSaving(true);
    const result = await addSalesEntry(d.id, { pax: paxNumber, docket_no: docket, note });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(paxNumber > 0 ? `נרשמו ${paxNumber} נוסעים` : `נרשם ביטול של ${Math.abs(paxNumber)} נוסעים`);
    setPax("");
    setNote("");
    await onSaved();
  };

  const remove = async (entry: CardSalesEntry) => {
    const agreed = await confirm({
      title: `למחוק את הרישום?${RLM}`,
      description: `רישום של ${entry.pax} נוסעים מ-${fmtInstant(entry.created_at)}. המחיקה נרשמת ביומן הפעולות.${RLM}`,
      confirmLabel: "מחיקה",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!agreed) return;
    setRemoving(entry.id);
    const result = await deleteSalesEntry(entry.id);
    setRemoving(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("הרישום נמחק");
    await onSaved();
  };

  return (
    <div className="space-y-4 py-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="מושבים משויכים" value={allocated} tone={allocated === 0 ? "muted" : undefined} />
        <Stat label="נמכרו" value={sold} />
        <Stat label="יתרה" value={remaining} tone={remaining < 0 ? "bad" : allocated === 0 ? "muted" : undefined} />
      </div>
      {remaining < 0 && (
        <Notice tone="error">
          חריגה: נמכרו {Math.abs(remaining)} מקומות יותר ממה שמשויך ליציאה{liveBlocks === 0 ? " (אין בלוק טיסה חי)" : ""}.
        </Notice>
      )}

      {!readOnly && (
        <div className="rounded-md border bg-muted/30 p-3">
          <h3 className="mb-2 text-sm font-semibold">רישום מכירה</h3>
          <div className="grid grid-cols-[7rem_9rem_1fr_auto] items-end gap-2">
            <Field label="נוסעים" hint="מספר שלילי = ביטול">
              <Input
                dir="ltr"
                inputMode="numeric"
                aria-label="מספר נוסעים"
                className="h-9 text-end"
                value={pax}
                placeholder="4"
                onChange={(e) => setPax(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && paxValid && !saving) void add();
                }}
              />
            </Field>
            <Field label="Docket" hint="לא חובה">
              <Input dir="ltr" aria-label="מספר Docket" className="h-9" value={docket} onChange={(e) => setDocket(e.target.value)} />
            </Field>
            <Field label="הערה" hint="לא חובה">
              <Input aria-label="הערה" className="h-9" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button className="mb-[18px] h-9" disabled={!paxValid || saving} onClick={add}>
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              הוספה
            </Button>
          </div>
        </div>
      )}

      {data.sales.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">עוד לא נרשמו מכירות ליציאה הזו.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm" data-testid="sales-entries">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-start font-semibold">מתי</th>
                <th className="px-3 py-1.5 text-start font-semibold">מי</th>
                <th className="px-3 py-1.5 text-center font-semibold">נוסעים</th>
                <th className="px-3 py-1.5 text-start font-semibold">Docket</th>
                <th className="px-3 py-1.5 text-start font-semibold">הערה</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {data.sales.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    <Ltr>{fmtInstant(e.created_at)}</Ltr>
                  </td>
                  <td className="px-3 py-1.5">{e.entered_by_name ?? "—"}</td>
                  <td className={cn("px-3 py-1.5 text-center font-semibold tabular-nums", e.pax < 0 ? "text-destructive" : "text-success")}>
                    <Ltr>{e.pax > 0 ? `+${e.pax}` : e.pax}</Ltr>
                  </td>
                  <td className="px-3 py-1.5">
                    <Ltr>{e.docket_no ?? ""}</Ltr>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{e.note ?? ""}</td>
                  <td className="px-1 py-1">
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="מחיקת הרישום"
                        disabled={removing === e.id}
                        onClick={() => remove(e)}
                      >
                        {removing === e.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
