"use client";

// "עריכה" on a competitor row of the detailed comparison (2026-09-18). Staff fix what the crawl -
// or the AI - got wrong about ONE listing: its price, what the package contains, or that it is
// not our event at all, with a reason and a note. Only the fields that changed are sent; what
// the crawl said and who said it is worked out on the server (saveListingCorrections). Our own
// side has no dialog: it is the pricing rule's answer, refreshed by "פרט את שלנו עכשיו".
import { useMemo, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { revokeListingCorrection, saveListingCorrections } from "@/lib/actions/price-light-actions";
import {
  CORRECTION_NOTE_MAX, CORRECTION_NOTE_MIN, CORRECTION_REASONS, CORRECTION_TEXT_MAX,
  type AttrField, type CorrectionField,
} from "@/lib/services/price-light-corrections";
import { COMPETITOR_LABEL } from "@/app/(dashboard)/events/price-light-ui";
import type { ComparisonOffer, Currency, OfferCorrection, PriceLightComparison, PriceLightRow, Scope } from "@/types/price-light.types";

export const FIELD_HE: Record<CorrectionField, string> = {
  price: "מחיר", not_same_event: "לא אותו אירוע", nights: "לילות", hotel_stars: "כוכבי מלון",
  breakfast: "ארוחת בוקר", bag_included: "מזוודה כלולה", direct_flight: "טיסה ישירה", transfers: "העברות",
  airline: "חברת תעופה", hotel_name: "שם המלון", ticket: "סוג כרטיס",
};

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP", "ILS"];
const TRI_FIELDS: AttrField[] = ["direct_flight", "bag_included", "breakfast", "transfers"];
type Tri = "yes" | "no" | "unknown";

const triOf = (v: unknown): Tri => (v === true ? "yes" : v === false ? "no" : "unknown");
const triValue = (t: Tri): boolean | null => (t === "yes" ? true : t === "no" ? false : null);

/** A stored correction value, worded for a human. */
export function correctionValueText(v: unknown): string {
  if (v === null || v === undefined || v === "unknown" || v === "") return "לא ידוע";
  if (v === true) return "כן";
  if (v === false) return "לא";
  if (typeof v === "object") {
    const p = v as { amount?: number; currency?: string };
    return `${p.amount ?? "?"} ${p.currency ?? ""}`.trim();
  }
  return String(v);
}

interface FormState {
  notSameEvent: boolean;
  amount: string; currency: Currency;
  nights: string; stars: string;
  tri: Record<string, Tri>;
  airline: string; hotel_name: string; ticket: string;
}

function initialState(offer: ComparisonOffer): FormState {
  const e = offer.edit;
  return {
    notSameEvent: false,
    amount: e?.price ? String(e.price.amount) : "",
    currency: e?.price?.currency ?? "EUR",
    nights: typeof e?.attrs.nights === "number" ? String(e.attrs.nights) : "",
    stars: typeof e?.attrs.hotel_stars === "number" ? String(e.attrs.hotel_stars) : "unknown",
    tri: Object.fromEntries(TRI_FIELDS.map((f) => [f, triOf(e?.attrs[f])])),
    airline: e?.airline ?? "", hotel_name: e?.hotel_name ?? "", ticket: e?.ticket ?? "",
  };
}

/** The server's own bound (validateCorrection) - the button stays off rather than the save bouncing. */
const NIGHTS_MAX = 21;
const nightsValid = (s: string): boolean => !s.trim() || (Number(s) >= 1 && Number(s) <= NIGHTS_MAX);

/** Only what differs from what the dialog opened with - each entry becomes one correction. */
function changesOf(now: FormState, was: FormState, pkg: boolean): { field: CorrectionField; value: unknown }[] {
  if (now.notSameEvent) return [{ field: "not_same_event", value: true }];
  const out: { field: CorrectionField; value: unknown }[] = [];
  if (now.amount.trim() && (now.amount !== was.amount || now.currency !== was.currency)) {
    out.push({ field: "price", value: { amount: Number(now.amount), currency: now.currency } });
  }
  const text = (field: "airline" | "hotel_name" | "ticket") => {
    if (now[field].trim() !== was[field].trim()) out.push({ field, value: now[field].trim() || null });
  };
  if (pkg) {
    if (now.nights !== was.nights) out.push({ field: "nights", value: now.nights.trim() ? Number(now.nights) : null });
    if (now.stars !== was.stars) out.push({ field: "hotel_stars", value: now.stars === "unknown" ? null : Number(now.stars) });
    for (const f of TRI_FIELDS) if (now.tri[f] !== was.tri[f]) out.push({ field: f, value: triValue(now.tri[f]) });
    text("airline");
    text("hotel_name");
  }
  text("ticket");
  return out;
}

export function CorrectionDialog({
  eventId, scope, offer, open, onOpenChange, onChanged,
}: {
  eventId: number;
  scope: Scope;
  offer: ComparisonOffer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (comparison: PriceLightComparison | null, row: PriceLightRow | null) => void;
}) {
  const { toast } = useToast();
  const was = useMemo(() => initialState(offer), [offer]);
  const [form, setForm] = useState<FormState>(was);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pkg = scope === "package";
  const name = offer.who === "ours" ? "" : COMPETITOR_LABEL[offer.who] ?? offer.who;
  const changes = changesOf(form, was, pkg);
  const noteOk = note.trim().length >= CORRECTION_NOTE_MIN;
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!offer.edit) return;
    setBusy(true);
    try {
      const res = await saveListingCorrections({ eventId, listingId: offer.edit.listing_id, changes, reason, note });
      if (!res.ok) { toast({ variant: "destructive", title: "התיקון לא נשמר", description: res.error }); return; }
      toast({
        title: res.saved === 0 ? "לא היה מה לשנות" : res.recomputed ? "התיקון נשמר והרמזור חושב מחדש" : "התיקון נשמר",
        description: res.saved > 0 && !res.recomputed ? "חישוב הרמזור נכשל כרגע - לחצו \"בדוק עכשיו\" בשורה, או שיתעדכן בלילה." : undefined,
      });
      onChanged(res.comparison, res.row);
      onOpenChange(false);
    } catch (e) {
      console.error("saveListingCorrections failed", e);
      toast({ variant: "destructive", title: "התיקון לא נשמר", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (c: OfferCorrection) => {
    setBusy(true);
    try {
      const res = await revokeListingCorrection(eventId, c.id);
      if (!res.ok) { toast({ variant: "destructive", title: "הביטול נכשל", description: res.error }); return; }
      toast({
        title: "התיקון בוטל - הערך מהסריקה חזר",
        description: res.recomputed ? undefined : "חישוב הרמזור נכשל כרגע - לחצו \"בדוק עכשיו\" בשורה, או שיתעדכן בלילה.",
      });
      onChanged(res.comparison, res.row);
      onOpenChange(false);
    } catch (e) {
      console.error("revokeListingCorrection failed", e);
      toast({ variant: "destructive", title: "הביטול נכשל", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>תיקון · {name}</DialogTitle>
          <DialogDescription className="text-xs">
            {offer.title ? <bdi>{offer.title}</bdi> : "המודעה כבר לא משויכת לאירוע"}
            <br />
            התיקון מונח מעל מה שנסרק, מחשב את הרמזור מחדש מיד, ונרשם כלקח ל-AI. הוא תקף עד שהערך באתר המתחרה משתנה.
          </DialogDescription>
        </DialogHeader>

        {offer.corrections.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
            <div className="font-medium">תיקונים פעילים</div>
            {offer.corrections.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-medium">{FIELD_HE[c.field as CorrectionField] ?? c.field}</span>
                  {c.field !== "not_same_event" && (
                    <> · <bdi>{correctionValueText(c.original)}</bdi> ← <bdi>{correctionValueText(c.value)}</bdi></>
                  )}
                  <div className="text-muted-foreground"><bdi>{c.note}</bdi>{c.by ? ` · ${c.by}` : ""} · {c.at.slice(0, 10)}</div>
                </div>
                <Button size="sm" variant="ghost" className="h-6 shrink-0 px-1.5 text-xs" disabled={busy} onClick={() => revoke(c)}>
                  <Undo2 className="me-1 h-3 w-3" aria-hidden />בטל
                </Button>
              </div>
            ))}
          </div>
        )}

        {offer.edit && (
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2 rounded-md border p-2">
              <Checkbox checked={form.notSameEvent} onCheckedChange={(v) => set({ notSameEvent: v === true })} />
              <span>המודעה הזו היא <strong>לא האירוע שלנו</strong> (תוסר מההשוואה של האירוע הזה בלבד)</span>
            </label>

            <fieldset disabled={form.notSameEvent} className="space-y-3 disabled:opacity-40">
              <div className="grid grid-cols-[1fr_6.5rem] gap-2">
                <div className="space-y-1">
                  <Label htmlFor="corr-amount">מחיר לאדם, כפי שמפורסם</Label>
                  <Input id="corr-amount" dir="ltr" inputMode="numeric" value={form.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d]/g, "") })} />
                </div>
                <div className="space-y-1">
                  <Label>מטבע</Label>
                  <Select value={form.currency} onValueChange={(v) => set({ currency: v as Currency })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {pkg && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="corr-nights">{FIELD_HE.nights}</Label>
                      <Input id="corr-nights" dir="ltr" inputMode="numeric" placeholder="לא ידוע" value={form.nights} onChange={(e) => set({ nights: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })} />
                    </div>
                    <div className="space-y-1">
                      <Label>{FIELD_HE.hotel_stars}</Label>
                      <Select value={form.stars} onValueChange={(v) => set({ stars: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unknown">לא ידוע</SelectItem>
                          {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}★</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {TRI_FIELDS.map((f) => (
                      <div key={f} className="space-y-1">
                        <Label>{FIELD_HE[f]}</Label>
                        <Select value={form.tri[f]} onValueChange={(v) => set({ tri: { ...form.tri, [f]: v as Tri } })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">כן</SelectItem>
                            <SelectItem value="no">לא</SelectItem>
                            <SelectItem value="unknown">לא ידוע</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="corr-airline">{FIELD_HE.airline}</Label>
                      <Input id="corr-airline" dir="auto" maxLength={CORRECTION_TEXT_MAX} value={form.airline} onChange={(e) => set({ airline: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="corr-hotel">{FIELD_HE.hotel_name}</Label>
                      <Input id="corr-hotel" dir="auto" maxLength={CORRECTION_TEXT_MAX} value={form.hotel_name} onChange={(e) => set({ hotel_name: e.target.value })} />
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label htmlFor="corr-ticket">{FIELD_HE.ticket}</Label>
                <Input id="corr-ticket" dir="auto" maxLength={CORRECTION_TEXT_MAX} value={form.ticket} onChange={(e) => set({ ticket: e.target.value })} />
              </div>
            </fieldset>

            <div className="space-y-1">
              <Label>למה הערך היה שגוי?</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue placeholder="בחר סיבה" /></SelectTrigger>
                <SelectContent>{CORRECTION_REASONS.map((r) => <SelectItem key={r.id} value={r.id}>{r.he}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="corr-note">הערה ל-AI (חובה)</Label>
              <Textarea id="corr-note" dir="auto" rows={2} maxLength={CORRECTION_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="מה ראית בדף המתחרה, ולמה המערכת טעתה" />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          {offer.edit && (
            <Button onClick={save} disabled={busy || changes.length === 0 || !reason || !noteOk || !nightsValid(form.nights) || (form.amount.trim() !== "" && Number(form.amount) < 1)}>
              {busy && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />}
              שמור {changes.length > 0 ? `(${changes.length})` : ""}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
