"use client";

/**
 * A tour's cancellation fees (tours.cancellation_rules - Alon 20.10.2026, Dor chose rules beside the terms text):
 * per part of the tour (hotel / flights / land / other), a fee that holds while at least N days are left before the
 * departure, and one "until the departure" fee. Each order on the customer page reads its fee as of today from them.
 * Saved on its own (the tour form's Save does not carry it). Loads when opened. Rules: lib/tours/cancellation.ts.
 */
import { useState } from "react";
import { ChevronRight, Loader2, PlusCircle, Receipt, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtPrice } from "@/lib/tours/format";
import { getCancellationRules, saveCancellationRules } from "@/lib/actions/tours-payments-actions";
import {
  CANCEL_COMPONENTS,
  CANCEL_COMPONENT_LABELS,
  CANCEL_FEE_KINDS,
  CANCEL_FEE_KIND_LABELS,
  checkCancellationRules,
  ruleFeeText,
  sortRules,
  type CancelComponent,
  type CancelFeeKind,
  type CancellationRule,
} from "@/lib/tours/cancellation";

type Row = { key: number; component: CancelComponent; days: string; feeKind: CancelFeeKind; feeValue: string };

let nextKey = 1;
const rowOf = (r: CancellationRule): Row => ({
  key: nextKey++,
  component: r.component,
  days: r.untilDaysBefore === null ? "" : String(r.untilDaysBefore),
  feeKind: r.feeKind,
  feeValue: String(r.feeValue),
});
const ruleOf = (r: Row): CancellationRule => ({
  component: r.component,
  untilDaysBefore: r.days.trim() === "" ? null : Number(r.days),
  feeKind: r.feeKind,
  feeValue: Number(r.feeValue),
});

/** One part's windows in words: "$100 per passenger while 17+ days are left, then $200 per passenger up to the departure". */
function sentenceOf(rules: CancellationRule[], money: (n: number) => string): string {
  return rules
    .map((r, i) =>
      r.untilDaysBefore === null
        ? `${i > 0 ? "then " : ""}${ruleFeeText(r, money)} up to the departure`
        : `${i > 0 ? "then " : ""}${ruleFeeText(r, money)} while ${r.untilDaysBefore}+ days are left`,
    )
    .join(", ");
}

export function CancellationRulesEditor({ packageId }: { packageId: string }) {
  const run = useActionToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saved, setSaved] = useState<string>("[]");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => fmtPrice(n, currency);

  const load = async () => {
    setBusy(true);
    const result = await run(() => getCancellationRules(packageId));
    setBusy(false);
    if (!result.success) return;
    setRows(result.data.rules.map(rowOf));
    setSaved(JSON.stringify(result.data.rules));
    setCurrency(result.data.currency);
  };
  const toggle = (next: boolean) => {
    setOpen(next);
    if (next && rows === null && !busy) void load();
  };

  const rules = (rows ?? []).map(ruleOf);
  const problem = rows ? checkCancellationRules(rules) : null;
  const dirty = rows !== null && JSON.stringify(sortRules(rules)) !== saved;
  const set = (key: number, patch: Partial<Row>) => setRows((list) => list && list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    const result = await run(() => saveCancellationRules(packageId, rules), "Cancellation fees saved");
    setBusy(false);
    if (!result.success) return;
    setRows(result.data.map(rowOf));
    setSaved(JSON.stringify(result.data));
  };

  return (
    <Collapsible open={open} onOpenChange={toggle} asChild>
      <section className="group overflow-hidden rounded-lg border bg-card">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:-scale-x-100" />
          <Receipt className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Cancellation fees</span>
          <span className="text-sm text-muted-foreground">What cancelling costs, by days before the departure - each order shows its fee as of today.</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t p-4">
          {rows === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {rows.length === 0 && <p className="text-sm text-muted-foreground">No fees yet. Add a rule per part of the tour.</p>}
              {rows.length > 0 && (
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div key={r.key} className="flex flex-wrap items-center gap-2">
                      <Select value={r.component} onValueChange={(component) => set(r.key, { component: component as CancelComponent })}>
                        <SelectTrigger className="h-9 w-32" aria-label="Part of the tour">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CANCEL_COMPONENTS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {CANCEL_COMPONENT_LABELS[c]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        className="h-9 w-24"
                        aria-label="Fee"
                        value={r.feeValue}
                        onChange={(e) => set(r.key, { feeValue: e.target.value })}
                      />
                      <Select value={r.feeKind} onValueChange={(feeKind) => set(r.key, { feeKind: feeKind as CancelFeeKind })}>
                        <SelectTrigger className="h-9 w-44" aria-label="How the fee counts">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CANCEL_FEE_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k === "percent" ? "% of the order" : `${currency} ${CANCEL_FEE_KIND_LABELS[k]}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">while</span>
                      <Input
                        inputMode="numeric"
                        dir="ltr"
                        className="h-9 w-20"
                        aria-label="Days before the departure"
                        placeholder="-"
                        value={r.days}
                        onChange={(e) => set(r.key, { days: e.target.value })}
                      />
                      <span className="text-sm text-muted-foreground">{r.days.trim() === "" ? "(empty = up to the departure)" : "or more days are left"}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label="Remove the rule"
                        onClick={() => setRows((list) => list && list.filter((x) => x.key !== r.key))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {/* the rules in words, part by part - what a rep reads on an order */}
              {!problem && rules.length > 0 && (
                <ul className="space-y-0.5 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {CANCEL_COMPONENTS.filter((c) => rules.some((r) => r.component === c)).map((c) => (
                    <li key={c}>
                      <strong>{CANCEL_COMPONENT_LABELS[c]}:</strong> {sentenceOf(sortRules(rules.filter((r) => r.component === c)), money)}
                      {!rules.some((r) => r.component === c && r.untilDaysBefore === null) && (
                        <span className="text-amber-700 dark:text-amber-300"> - nothing set for the last days</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {problem && <p className="text-sm text-destructive">{problem}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((list) => [...(list ?? []), { key: nextKey++, component: "flight", days: "", feeKind: "per_pax", feeValue: "0" }])}
                >
                  <PlusCircle className="h-4 w-4" />
                  Add a rule
                </Button>
                <span className="flex-1" />
                {dirty && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load()}>
                    Discard
                  </Button>
                )}
                <Button size="sm" disabled={busy || !dirty || !!problem} onClick={() => void save()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save fees
                </Button>
              </div>
            </>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
