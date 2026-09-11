"use client";

// Per-row decision buttons for the /price-light table. Red rows get the four
// "what do we do about it" actions; every row gets "בדוק עכשיו" (re-match
// against the stored catalogs, no browsing) and "דריסה" (manual override).
import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {row.light === "red" && (
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={`/events/${row.event_id}#fix-price`}>הוזל</Link>
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={silence}>
            השאר בפיד
          </Button>
          <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setRemoveOpen(true)}>
              הסר מהאתר
            </Button>
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
          <Button size="sm" variant="outline" disabled={busy} onClick={openTask}>
            משימה
          </Button>
        </>
      )}

      <Button size="sm" variant="ghost" disabled={busy} onClick={recheck} title="בדוק שוב מול הקטלוגים השמורים">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "בדוק עכשיו"}
      </Button>

      {row.override ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={clearOverride}>
          בטל דריסה
        </Button>
      ) : (
        <Popover open={overrideOpen} onOpenChange={setOverrideOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy}>
              דריסה
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
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
            <Button
              size="sm"
              className="w-full"
              disabled={busy || overrideNote.trim().length < 3}
              onClick={submitOverride}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "שמור דריסה"}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
