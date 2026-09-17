"use client";

// Per-row decision buttons for the /price-light table. A red row keeps one
// primary action visible (הוזל - just a Link) and moves the rest into an
// overflow menu; every other row only needs the menu (בדוק עכשיו + דריסה).
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, MoreHorizontal } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  LIGHT_GREEN_USD, LIGHT_RED_USD, ourPackageUsd, previewMarkupChange, PRICE_DROP_MIN_USD, signedUsd,
} from "@/lib/services/price-light";
import { heLabel, PILL } from "@/app/(dashboard)/events/price-light-ui";
import {
  clearLightOverride,
  markRepriced,
  openPriceLightTask,
  recheckEvent,
  removeEventFromSite,
  setEventMarkupFromLight,
  setEventSoldOut,
  setLightOverride,
  silenceRedLight,
} from "@/lib/actions/price-light-actions";
// "use server" files may only export async functions, so this plain constant
// lives in a sibling module instead of price-light-actions.ts.
import { SILENCE_DAYS } from "@/lib/actions/price-light-constants";
import { rowScopes, type Light, type PriceLightRow, type PriceLightScopeCell, type Scope } from "@/types/price-light.types";

// "na" is not a settable override - a scope is only ever overridden to one of
// these five states (matches the /price-light table's LIGHTS minus "na").
const OVERRIDE_LIGHTS: Light[] = ["alone", "green", "orange", "red", "unchecked"];
const OVERRIDE_LABEL: Record<Light, string> = {
  alone: "לבד בשוק",
  green: "ירוק",
  orange: "כתום",
  red: "אדום",
  unchecked: "לא נבדק",
  na: "—",
};

const SCOPE_HE: Record<Scope, string> = { package: "חבילה", ticket: "כרטיס" };

const REPRICE_FAIL: Record<string, string> = {
  invalid: "ערך לא תקין (0 עד 5000)",
  not_found: "האירוע לא נמצא",
  db: "השמירה נכשלה",
  failed: "שגיאה",
};

/**
 * "הוזל" (note 10): edit ONLY the markup of the red scope, see what it would do before saving.
 * package -> the per-event extra markup, ticket -> the ticket-only markup. The preview runs the
 * same pure price functions and light band as the engine, against the competitor that set the light.
 */
function RepricePopover({
  row, cell, label, onSaved,
}: {
  row: PriceLightRow; cell: PriceLightScopeCell; label: string; onSaved: (fresh: PriceLightRow | null) => void;
}) {
  const { toast } = useToast();
  const current = cell.scope === "package" ? row.pricing.event_additional_markup ?? 0 : row.pricing.ticket_only_markup ?? 0;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(current));
  const [markDrop, setMarkDrop] = useState(false);
  const [saving, setSaving] = useState(false);

  // An empty field on the ticket scope CLEARS the ticket-only price (the server's null path);
  // on a package it is simply not a number yet.
  const cleared = text.trim() === "";
  const value = cleared ? null : Number(text);
  const valid = cleared ? cell.scope === "ticket" : value != null && Number.isFinite(value) && value >= 0 && value <= 5000;
  // A manual override on this scope is re-applied by every recompute, whatever our price does -
  // promising a new light here would send the reader cutting again and again.
  const overridden = row.override?.scope === cell.scope;
  const preview = valid && value != null ? previewMarkupChange(row.pricing, cell.scope, value, cell.normalized_usd, cell.uncertainty_usd) : null;
  // The site card price moves by the same delta - that is what a "ירידת מחיר" tag is measured on.
  const siteBefore = cell.scope === "package" ? ourPackageUsd(row.pricing) : null;
  const siteAfter = cell.scope === "package" && valid && value != null ? ourPackageUsd({ ...row.pricing, event_additional_markup: value }) : null;
  const siteDrop = siteBefore != null && siteAfter != null ? siteBefore - siteAfter : 0;
  const canMarkDrop = siteDrop >= PRICE_DROP_MIN_USD;

  // One-click targets: the markup that lands this scope just inside orange / green, by the same
  // band the light uses. Offered only when the markup alone can get there (never below 0).
  const now = previewMarkupChange(row.pricing, cell.scope, current, cell.normalized_usd, cell.uncertainty_usd);
  const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
  const targets = now.diffUsd == null ? [] : [
    { label: "לכתום", value: current - ceil5(now.diffUsd - (LIGHT_RED_USD + cell.uncertainty_usd)) },
    { label: "לירוק", value: current - ceil5(now.diffUsd - (LIGHT_GREEN_USD - cell.uncertainty_usd) + 1) },
  ].filter((t) => t.value >= 0 && t.value < current);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await setEventMarkupFromLight(row.event_id, cell.scope, value, { markPriceDrop: markDrop && canMarkDrop });
      if (!res.ok) {
        toast({ variant: "destructive", title: "העדכון נכשל", description: REPRICE_FAIL[res.kind] ?? res.kind });
        return;
      }
      toast({ title: "המארקאפ עודכן", description: markDrop && canMarkDrop ? "סומן גם כירידת מחיר באתר" : undefined });
      setOpen(false);
      onSaved(res.row);
    } catch (e) {
      console.error("setEventMarkupFromLight failed", e);
      toast({ variant: "destructive", title: "העדכון נכשל", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setText(String(current)); setMarkDrop(false); } }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 text-sm" dir="rtl">
        <div className="space-y-1">
          <div className="font-medium">{cell.scope === "package" ? "מארקאפ נוסף לחבילה ($)" : "מארקאפ כרטיס בלבד ($)"}</div>
          <div className="text-xs text-muted-foreground">
            עורך רק את המארקאפ. מחירי הבסיס והכלל לא משתנים. כעת: ${current}
          </div>
        </div>
        <Input
          type="number" inputMode="numeric" min={0} max={5000} step={5} value={text} dir="ltr"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          className="h-9 tabular-nums"
          aria-label="מארקאפ בדולרים"
        />
        {targets.length > 0 && !overridden && (
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <Button key={t.label} type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setText(String(t.value))}>
                {t.label} · ${t.value}
              </Button>
            ))}
          </div>
        )}
        <div className="rounded-md border bg-muted/40 p-2 text-xs tabular-nums">
          {preview && preview.ourUsd != null ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>מחיר ← <span className="font-medium">${preview.ourUsd}</span></span>
              {preview.diffUsd != null && <span>פער ← <span className="font-medium">{signedUsd(preview.diffUsd)}</span></span>}
              {preview.light && !overridden && (
                <span className={cn("inline-flex rounded-full px-1.5 py-0.5 font-medium", PILL[preview.light])}>
                  {heLabel(preview.light, preview.diffUsd)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">
              {cleared && valid ? "שדה ריק = ביטול מחיר כרטיס בלבד לאירוע" : valid ? "אין מחיר להשוואה" : "הזן מספר בין 0 ל-5000"}
            </span>
          )}
          {overridden && (
            <div className="mt-1 text-warning">יש דריסה ידנית על האור הזה. האור לא ישתנה עד שתבוטל הדריסה.</div>
          )}
          {siteAfter != null && <div className="mt-1 text-muted-foreground">באתר ← ${siteAfter}</div>}
        </div>
        {cell.scope === "package" && (
          <label className={cn("flex items-start gap-2 text-xs", !canMarkDrop && "text-muted-foreground")}>
            <Checkbox checked={markDrop && canMarkDrop} disabled={!canMarkDrop} onCheckedChange={(v) => setMarkDrop(v === true)} className="mt-0.5" />
            <span>
              סמן &quot;המחיר ירד&quot; באתר ל-14 יום
              {!canMarkDrop && <span className="block">זמין מירידה של ${PRICE_DROP_MIN_USD} ומעלה במחיר באתר</span>}
            </span>
          </label>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link href={`/events/${row.event_id}#fix-price`} className="text-xs text-muted-foreground underline"
            // Going to the event to fix the price by hand is still "a human judged this gap real" -
            // recorded, and never allowed to block the navigation.
            onClick={() => { void markRepriced(row.event_id, cell.scope).catch((e) => console.error("markRepriced failed", e)); }}
          >
            לעריכה מלאה באירוע
          </Link>
          <Button size="sm" disabled={!valid || saving || value === current} onClick={save}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "שמור"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DecisionActions({
  row, onDone, onRowPatched,
}: {
  row: PriceLightRow;
  onDone: () => void;
  /** A decision that returns the fresh row patches it in place instead of reloading the list. */
  onRowPatched: (eventId: number, fresh: PriceLightRow | null) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");

  // The row is an EVENT now, carrying both conclusions, so a scope-specific decision has to say
  // WHICH one it is about (Dor, 2026-09-14). Where only one scope qualifies the button goes
  // straight there; where both do, the scope is part of the label, so it stays one click.
  const cells = rowScopes(row);
  const reds = cells.filter((c) => c.light === "red");
  const [overrideScope, setOverrideScope] = useState<Scope>(cells[0]?.scope ?? "package");
  const overrideCell = cells.find((c) => c.scope === overrideScope) ?? null;
  const [overrideLight, setOverrideLight] = useState<Light>(
    overrideCell && overrideCell.light !== "na" ? overrideCell.light : "unchecked",
  );

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast({ variant: "destructive", title: `${label} נכשל`, description: res.error });
        return false;
      }
      return true;
    } catch (e) {
      console.error(`${label} failed`, e);
      toast({ variant: "destructive", title: `${label} נכשל`, description: e instanceof Error ? e.message : "שגיאה" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const silence = async () => {
    const ok = await run("השארה בפיד", () => silenceRedLight(row.event_id));
    if (ok) {
      const until = new Date(Date.now() + SILENCE_DAYS * 86_400_000).toLocaleDateString("he-IL");
      toast({ title: `מושתק עד ${until}` });
      onDone();
    }
  };

  const remove = async () => {
    const ok = await run("הסרה מהאתר", () => removeEventFromSite(row.event_id));
    if (ok) {
      setRemoveOpen(false);
      toast({ title: "האירוע הוסר מהאתר" });
      onDone();
    }
  };

  const openTask = async (scope: Scope) => {
    setBusy(true);
    try {
      const res = await openPriceLightTask(row.event_id, scope);
      if (!res.ok) {
        toast({ variant: "destructive", title: "פתיחת משימה נכשלה", description: res.error });
        return;
      }
      toast({
        title: res.existed ? "יש כבר משימה פתוחה" : "משימה נפתחה",
        description: (
          <Link href="/tasks" className="underline">
            לצפייה במשימות
          </Link>
        ),
      });
      onDone();
    } catch (e) {
      console.error("openPriceLightTask failed", e);
      toast({ variant: "destructive", title: "פתיחת משימה נכשלה", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  // Row-only refresh (note 14): the fresh row comes back and is patched in place. A stale
  // description of OUR package is redone first, which takes a few seconds - say so.
  const recheck = async () => {
    setBusy(true);
    const waiting = toast({ title: "בודק עכשיו…", description: "אם הפירוט שלנו ישן הוא מתעדכן קודם (כמה שניות)" });
    try {
      const res = await recheckEvent(row.event_id, { withRow: true, describeOurs: true });
      waiting.dismiss();
      if (!res.ok) {
        toast({ variant: "destructive", title: "בדיקה נכשלה", description: res.error });
        return;
      }
      toast({ title: "נבדק עכשיו", description: res.described_ours ? "כולל פירוט מחדש של החבילה שלנו" : undefined });
      onRowPatched(row.event_id, res.row);
    } catch (e) {
      waiting.dismiss();
      console.error("recheckEvent failed", e);
      toast({ variant: "destructive", title: "בדיקה נכשלה", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  const toggleSoldOut = async () => {
    setBusy(true);
    try {
      const res = await setEventSoldOut(row.event_id, !row.sold_out);
      if (!res.ok) {
        toast({ variant: "destructive", title: "העדכון נכשל", description: REPRICE_FAIL[res.kind] ?? res.kind });
        return;
      }
      setSoldOpen(false);
      toast({ title: row.sold_out ? "הסולד אאוט בוטל" : "האירוע סומן סולד אאוט באתר" });
      onRowPatched(row.event_id, res.row);
    } catch (e) {
      console.error("setEventSoldOut failed", e);
      toast({ variant: "destructive", title: "העדכון נכשל", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  const submitOverride = async () => {
    const ok = await run("דריסה", () => setLightOverride(row.event_id, overrideScope, overrideLight, overrideNote));
    if (ok) {
      setOverrideOpen(false);
      setOverrideNote("");
      toast({ title: "הדריסה נשמרה" });
      onDone();
    }
  };

  const clearOverride = async () => {
    const ok = await run("ביטול דריסה", () => clearLightOverride(row.event_id));
    if (ok) {
      toast({ title: "הדריסה בוטלה" });
      onDone();
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {/* One button per red conclusion. With both red the scope is in the label, so "which one
          did I just judge real" is answered by the click itself rather than by a second dialog. */}
      {row.sold_out && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">סולד אאוט</span>
      )}
      {reds.map((cell) => (
        <RepricePopover
          key={cell.scope}
          row={row}
          cell={cell}
          label={reds.length > 1 ? `הוזל · ${SCOPE_HE[cell.scope]}` : "הוזל"}
          onSaved={(fresh) => onRowPatched(row.event_id, fresh)}
        />
      ))}
      <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="לעמוד האירוע באתר">
        <a href={row.site_url} target="_blank" rel="noreferrer" aria-label={`${row.name} באתר`}>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={busy}
            aria-label={`פעולות עבור ${row.name}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {reds.length > 0 && (
            <>
              {/* The mute is on the EVENT - it hides the row from "ממתינים להחלטה", and there is
                  one row per event now, so it needs no scope. */}
              <DropdownMenuItem disabled={busy} onClick={silence}>
                השאר בפיד
              </DropdownMenuItem>
              {reds.map((cell) => (
                <DropdownMenuItem key={cell.scope} disabled={busy} onClick={() => openTask(cell.scope)}>
                  {reds.length > 1 ? `משימה · ${SCOPE_HE[cell.scope]}` : "משימה"}
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuItem disabled={busy} onClick={recheck}>
            בדוק עכשיו
          </DropdownMenuItem>

          <DropdownMenuItem
            disabled={busy}
            onSelect={(e) => {
              e.preventDefault();
              if (row.sold_out) void toggleSoldOut(); else setSoldOpen(true);
            }}
          >
            {row.sold_out ? "בטל סולד אאוט" : "סולד אאוט"}
          </DropdownMenuItem>

          {row.override ? (
            <DropdownMenuItem disabled={busy} onClick={clearOverride}>
              בטל דריסה
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault();
                setOverrideOpen(true);
              }}
            >
              דריסה
            </DropdownMenuItem>
          )}

          {reds.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                className="text-destructive focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  setRemoveOpen(true);
                }}
              >
                הסר מהאתר
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rendered as siblings of the DropdownMenu, not inside it - the menu
          unmounts its content on close and would take a nested dialog with it. */}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>להסיר את האירוע מהאתר?</AlertDialogTitle>
            <AlertDialogDescription>
              {row.name} · {row.date}
              <br />
              האירוע יוסר בעדינות (soft delete) - לא ימחק לצמיתות.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "הסר"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={soldOpen} onOpenChange={setSoldOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>לסמן את האירוע סולד אאוט?</AlertDialogTitle>
            <AlertDialogDescription>
              {row.name} · {row.date}
              <br />
              האירוע נשאר באתר אבל מוצג כאזל ולא ניתן להזמנה, ויוצא מהחיפוש ומהפיד. אפשר לבטל מכאן בכל רגע.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void toggleSoldOut();
              }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "סמן סולד אאוט"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>דריסת אור</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* An override forces ONE conclusion, so when the row has both it must say which.
                With a single scope there is nothing to ask and the picker stays out of the way. */}
            {cells.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">על מה</label>
                <Select
                  value={overrideScope}
                  onValueChange={(v) => {
                    const scope = v as Scope;
                    setOverrideScope(scope);
                    // Start from the light being overruled, not from the other scope's - the
                    // dialog should open on what this conclusion currently says.
                    const next = cells.find((c) => c.scope === scope);
                    if (next && next.light !== "na") setOverrideLight(next.light);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cells.map((c) => (
                      <SelectItem key={c.scope} value={c.scope}>
                        {SCOPE_HE[c.scope]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">אור</label>
              <Select value={overrideLight} onValueChange={(v) => setOverrideLight(v as Light)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERRIDE_LIGHTS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {OVERRIDE_LABEL[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">הערה (חובה)</label>
              <Textarea
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="למה הדריסה נדרשת..."
                className="min-h-20 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              className="w-full"
              disabled={busy || overrideNote.trim().length < 3}
              onClick={submitOverride}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "שמור דריסה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
