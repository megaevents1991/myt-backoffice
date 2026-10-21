"use client";

/**
 * The customer pickers of the customer page (Nir 19.10): move a card to the right person, merge two customers
 * who are one. Both search the company's customers the same way (searchCustomers: a name, a phone, a C-number,
 * an e-mail) and ask once before they write.
 */
import { useEffect, useState } from "react";
import { GitMerge, Loader2, Search, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActionToast } from "@/hooks/use-action-toast";
import { mergeCustomers, moveCardToCustomer, searchCustomers } from "@/lib/actions/tours-cases-actions";
import { customerLabel, customerName, type CustomerCandidate, type CustomerInfo } from "@/lib/tours/cases";

/** Search the company's customers; the chosen one is highlighted. */
function CustomerPicker({
  excludeId,
  picked,
  onPick,
}: {
  excludeId?: string | null;
  picked: CustomerCandidate | null;
  onPick: (customer: CustomerCandidate) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CustomerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a quarter-second after the last key: one search per pause, not per letter
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const answer = await searchCustomers(query, excludeId ?? undefined);
      if (!live) return;
      setSearching(false);
      if (answer.success) {
        setResults(answer.data);
        setError(null);
      } else {
        setError(answer.error);
      }
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q, excludeId]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          autoFocus
          dir="auto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, phone, customer number or e-mail"
          className="ps-8"
          aria-label="Search customers"
        />
        {searching && <Loader2 className="absolute end-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Customers found">
        {results.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c)}
              aria-pressed={picked?.id === c.id}
              className={cn(
                "flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border px-3 py-2 text-start text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                picked?.id === c.id && "border-primary bg-primary/5",
              )}
            >
              <span className="font-mono text-xs text-muted-foreground">{customerLabel(c.customerNo)}</span>
              <span dir="auto" className="font-medium">
                {c.name || "No name"}
              </span>
              <span dir="ltr" className="tabular text-xs text-muted-foreground">
                {c.phones[0] ?? c.email ?? ""}
              </span>
              <span className="ms-auto text-xs text-muted-foreground">
                {c.cards} {c.cards === 1 ? "card" : "cards"}
              </span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && !searching && results.length === 0 && !error && <li className="px-1 text-sm text-muted-foreground">No customer matches.</li>}
      </ul>
    </div>
  );
}

/** "Move to another customer": the deal is another person's (a relative booked from their own phone). */
export function MoveCardDialog({
  cardId,
  caseNo,
  currentCustomerId,
  onCancel,
  onMoved,
}: {
  cardId: string;
  caseNo: number;
  currentCustomerId: string | null;
  onCancel: () => void;
  onMoved: (customerId: string) => void;
}) {
  const run = useActionToast();
  const [picked, setPicked] = useState<CustomerCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const move = async () => {
    if (!picked) return;
    setSaving(true);
    const result = await run(() => moveCardToCustomer(cardId, picked.id), `Card moved to ${customerLabel(picked.customerNo)}`);
    setSaving(false);
    if (result.success) onMoved(result.data.customerId);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            Move card #{caseNo} to another customer
          </DialogTitle>
          <DialogDescription>The card goes with everything on it - orders, seats, offer and notes. The person&apos;s own details stay theirs.</DialogDescription>
        </DialogHeader>
        <CustomerPicker excludeId={currentCustomerId} picked={picked} onPick={setPicked} />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!picked || saving} onClick={move}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {picked ? `Move to ${customerLabel(picked.customerNo)}` : "Choose a customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Merge with...": two customers are one person. The customer on screen stays (its number, its main phone); the other
 * one's cards and phones move in and it is marked merged. `preset` = the same-e-mail suggestion, already picked.
 */
export function MergeCustomerDialog({
  customer,
  preset,
  onCancel,
  onMerged,
}: {
  customer: CustomerInfo;
  preset?: CustomerCandidate | null;
  onCancel: () => void;
  onMerged: () => void;
}) {
  const run = useActionToast();
  const [picked, setPicked] = useState<CustomerCandidate | null>(preset ?? null);
  const [saving, setSaving] = useState(false);
  const merge = async () => {
    if (!picked) return;
    setSaving(true);
    const result = await run(
      () => mergeCustomers(customer.id, picked.id),
      (answer) => `${customerLabel(picked.customerNo)} merged into ${customerLabel(customer.customerNo)} - ${answer.data.moved} ${answer.data.moved === 1 ? "card" : "cards"} moved`,
    );
    setSaving(false);
    if (result.success) onMerged();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            Merge into {customerLabel(customer.customerNo)} <span dir="auto">{customerName(customer)}</span>
          </DialogTitle>
          <DialogDescription>
            {customerLabel(customer.customerNo)} stays. The other customer&apos;s cards and phones move here, and their number stops being used.
          </DialogDescription>
        </DialogHeader>
        {preset ? (
          <div className="rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{customerLabel(preset.customerNo)}</span>{" "}
            <span dir="auto" className="font-medium">
              {preset.name || "No name"}
            </span>{" "}
            <span dir="ltr" className="tabular text-xs text-muted-foreground">
              {preset.phones.join(", ")}
            </span>
          </div>
        ) : (
          <CustomerPicker excludeId={customer.id} picked={picked} onPick={setPicked} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!picked || saving} onClick={merge}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {picked ? `Merge ${customerLabel(picked.customerNo)} in` : "Choose a customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
