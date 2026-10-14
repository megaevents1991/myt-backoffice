"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Lock, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActionToast } from "@/hooks/use-action-toast";
import { saveCaseStatuses } from "@/lib/actions/tours-cases-actions";
import {
  STATUS_COLORS,
  STATUS_COLOR_CLASSES,
  STATUS_LABEL_MAX,
  STATUS_MAX,
  isStatusColor,
  type CaseStatus,
  type StatusDraft,
} from "@/lib/tours/cases";

type Row = StatusDraft & { isSystem: boolean; uid: string };

let uidSeq = 0;
const nextUid = () => `status-${++uidSeq}`;
const toRows = (statuses: readonly CaseStatus[]): Row[] =>
  statuses.map((s) => ({ key: s.key, label: s.label, color: s.color, isClosed: s.isClosed, isActive: s.isActive, isSystem: s.isSystem, uid: nextUid() }));

/**
 * The company's status list: rename, recolour, reorder, add a status, switch
 * one off. System statuses (a payment, a new booking moves a case into them)
 * keep their place in the rules and cannot be switched off; nothing is ever
 * removed - a case may carry it.
 */
export function StatusesDialog({
  open,
  onOpenChange,
  statuses,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: readonly CaseStatus[];
  onSaved: (statuses: CaseStatus[]) => void;
}) {
  const run = useActionToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRows(toRows(statuses));
      setError(null);
    }
  }, [open, statuses]);

  const patch = (uid: string, change: Partial<Row>) => setRows((current) => current.map((r) => (r.uid === uid ? { ...r, ...change } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    setError(null);
    setSaving(true);
    const result = await run(
      () => saveCaseStatuses(rows.map(({ key, label, color, isClosed, isActive }) => ({ key, label, color, isClosed, isActive }))),
      "Statuses saved",
    );
    setSaving(false);
    if (!result.success) return setError(result.error);
    onSaved(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Statuses</DialogTitle>
          <DialogDescription>
            The statuses a case can be in, in this order. A closed status ends the work on a case (no task, out of follow-up). Statuses with a lock are set
            by the system - rename or recolour them, they stay on.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto pe-1">
          <div className="grid grid-cols-[2rem_1fr_8rem_4.5rem_3.5rem_3.5rem] items-center gap-2 px-1 text-xs text-muted-foreground">
            <span />
            <span>Name</span>
            <span>Colour</span>
            <span>Closed</span>
            <span>On</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div key={row.uid} className={cn("grid grid-cols-[2rem_1fr_8rem_4.5rem_3.5rem_3.5rem] items-center gap-2 rounded-md border p-1", !row.isActive && "opacity-60")}>
              <span className="flex justify-center text-muted-foreground">{row.isSystem && <Lock className="h-3.5 w-3.5" aria-label="set by the system" />}</span>
              <Input
                dir="auto"
                value={row.label}
                maxLength={STATUS_LABEL_MAX}
                aria-label="Status name"
                className="h-8"
                onChange={(e) => patch(row.uid, { label: e.target.value })}
              />
              <Select value={row.color} onValueChange={(color) => patch(row.uid, { color })}>
                <SelectTrigger className="h-8" aria-label="Colour">
                  <SelectValue>
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", isStatusColor(row.color) && STATUS_COLOR_CLASSES[row.color])}>{row.color}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_COLORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className={cn("rounded-full border px-2 py-0.5 text-xs", STATUS_COLOR_CLASSES[c])}>{c}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Switch
                checked={row.isClosed}
                disabled={row.isSystem}
                aria-label="Closed"
                onCheckedChange={(isClosed) => patch(row.uid, { isClosed })}
              />
              <Switch checked={row.isActive} disabled={row.isSystem} aria-label="On" onCheckedChange={(isActive) => patch(row.uid, { isActive })} />
              <span className="flex">
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length >= STATUS_MAX}
            onClick={() => setRows((current) => [...current, { key: null, label: "", color: "gray", isClosed: false, isActive: true, isSystem: false, uid: nextUid() }])}
          >
            <Plus className="h-4 w-4" />
            Add status
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
