"use client";

import { useEffect, useRef, useState } from "react";
import { GitMerge, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchInput } from "@/components/search-input";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtInstant } from "@/lib/tours/format";
import { findMergeCandidates, mergeCases } from "@/lib/actions/tours-cases-actions";
import type { CaseCandidate, CaseStatus } from "@/lib/tours/cases";
import { StatusTag, TypeBadge } from "@/components/tours/cases/case-ui";

/**
 * "Link to another case" - one customer, one case (Alon 15.10): a booking sent with another phone,
 * or a second booking of a known customer, is joined to the customer's case. The same customer
 * (same phone or e-mail) is listed first; anything else is found by case number, name, phone,
 * e-mail or booking ref. The OLDER case stays (the customer's first file - its rep, its campaign);
 * the newer one's bookings, seats and notes move into it.
 */
export function MergeDialog({
  open,
  onOpenChange,
  caseId,
  caseNo,
  statuses,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNo: number;
  statuses: readonly CaseStatus[];
  onMerged: (keptId: string) => void;
}) {
  const run = useActionToast();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CaseCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CaseCandidate | null>(null);
  const seq = useRef(0);

  // search as the rep types (300 ms after the last key); the same customer shows with an empty box
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const answer = await findMergeCandidates(caseId, query);
      if (mine !== seq.current) return;
      setLoading(false);
      setRows(answer.success ? answer.data : []);
    }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [open, caseId, query]);

  const merge = async (other: CaseCandidate) => {
    setMerging(other.id);
    const result = await run(() => mergeCases(caseId, other.id), (answer) => `Case #${answer.data.mergedNo} joined case #${answer.data.keptNo}`);
    setMerging(null);
    setConfirming(null);
    if (result.success) {
      onOpenChange(false);
      onMerged(result.data.keptId);
    }
  };

  const kept = (other: CaseCandidate) => Math.min(caseNo, other.caseNo);
  const moved = (other: CaseCandidate) => Math.max(caseNo, other.caseNo);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(null);
          setQuery("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link case #{caseNo} to another case</DialogTitle>
          <DialogDescription>
            For one customer with two cases - say a booking sent with another phone. The older case stays; the newer one&apos;s bookings, seats and notes
            move into it.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                Case #{moved(confirming)} joins case #{kept(confirming)}.
              </p>
              <p className="mt-1 text-muted-foreground">
                Its bookings and seats move to #{kept(confirming)}, its notes are added, and #{moved(confirming)} leaves the table. This cannot be undone
                from the screen.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)} disabled={!!merging}>
                Back
              </Button>
              <Button onClick={() => void merge(confirming)} disabled={!!merging}>
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                Merge into #{kept(confirming)}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              wrapperClassName="sm:w-full"
              placeholder="Case number, name, phone, e-mail or booking ref (T10026)"
              autoFocus
            />
            <div className="max-h-[50vh] space-y-2 overflow-y-auto" aria-live="polite" aria-busy={loading}>
              {rows === null || (loading && rows.length === 0) ? (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking for this customer&apos;s other cases…
                </p>
              ) : rows.length === 0 ? (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Search className="h-4 w-4" />
                  {query ? "No case matches." : "No other case with this phone or e-mail - search by name, phone or booking ref."}
                </p>
              ) : (
                rows.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
                    <span className="font-mono text-muted-foreground">#{c.caseNo}</span>
                    <span dir="auto" className="font-medium">
                      {c.name || "No name"}
                    </span>
                    <TypeBadge type={c.type} />
                    <StatusTag status={c.status} statuses={statuses} />
                    {c.samePerson && (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Same phone / e-mail</span>
                    )}
                    <span className="basis-full text-xs text-muted-foreground" dir="auto">
                      {[c.phone, c.email, c.bookingRefs.length ? `Bookings ${c.bookingRefs.join(", ")}` : "No booking", `Opened ${fmtInstant(c.createdAt)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <Button size="sm" variant="outline" className="ms-auto" onClick={() => setConfirming(c)}>
                      <GitMerge className="h-4 w-4" />
                      Link
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
