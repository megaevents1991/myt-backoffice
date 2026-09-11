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
  openPriceLightTask,
  recheckEvent,
  removeEventFromSite,
  setLightOverride,
  silenceRedLight,
  type PriceLightRow,
} from "@/lib/actions/price-light-actions";
// "use server" files may only export async functions, so this plain constant
// lives in a sibling module instead of price-light-actions.ts.
import { SILENCE_DAYS } from "@/lib/actions/price-light-constants";
import type { Light } from "@/types/price-light.types";

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

export function DecisionActions({ row, onDone }: { row: PriceLightRow; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideLight, setOverrideLight] = useState<Light>(row.light === "na" ? "unchecked" : row.light);
  const [overrideNote, setOverrideNote] = useState("");

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

  const openTask = async () => {
    setBusy(true);
    try {
      const res = await openPriceLightTask(row.event_id, row.scope);
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
    const ok = await run("דריסה", () => setLightOverride(row.event_id, row.scope, overrideLight, overrideNote));
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
      {row.light === "red" && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/events/${row.event_id}#fix-price`}>הוזל</Link>
        </Button>
      )}

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
          {row.light === "red" && (
            <>
              <DropdownMenuItem disabled={busy} onClick={silence}>
                השאר בפיד
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={openTask}>
                משימה
              </DropdownMenuItem>
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

          {row.light === "red" && (
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
