"use client";

// Per-row decision buttons for the /price-light table. A red row keeps one
// primary action visible (הוזל - just a Link) and moves the rest into an
// overflow menu; every other row only needs the menu (בדוק עכשיו + דריסה).
import { useState } from "react";
import Link from "next/link";
import { Loader2, MoreHorizontal } from "lucide-react";

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
import {
  clearLightOverride,
  markRepriced,
  openPriceLightTask,
  recheckEvent,
  removeEventFromSite,
  setLightOverride,
  silenceRedLight,
} from "@/lib/actions/price-light-actions";
// "use server" files may only export async functions, so this plain constant
// lives in a sibling module instead of price-light-actions.ts.
import { SILENCE_DAYS } from "@/lib/actions/price-light-constants";
import { rowScopes, type Light, type PriceLightRow, type Scope } from "@/types/price-light.types";

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

export function DecisionActions({ row, onDone }: { row: PriceLightRow; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
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

  const recheck = async () => {
    const ok = await run("בדיקה", () => recheckEvent(row.event_id));
    if (ok) onDone();
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
      {reds.map((cell) => (
        <Button asChild key={cell.scope} size="sm" variant="outline">
          {/* Still a plain link to the price section - the light never writes a price. The click
              is recorded first (markRepriced) because "a human judged this gap real" is the
              single strongest signal we have, and until now it left no trace at all. Recording
              must never block the navigation: on failure we log and go anyway. */}
          <Link
            href={`/events/${row.event_id}#fix-price`}
            onClick={() => {
              void markRepriced(row.event_id, cell.scope).catch((e) =>
                console.error("markRepriced failed", e),
              );
            }}
          >
            {reds.length > 1 ? `הוזל · ${SCOPE_HE[cell.scope]}` : "הוזל"}
          </Link>
        </Button>
      ))}

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
