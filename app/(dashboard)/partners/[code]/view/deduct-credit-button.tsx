"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { deductPartnerCredit } from "@/lib/actions/partner-credit-actions";
import { MIN_DEDUCT_USD, deductionProblem } from "@/lib/partner-credit-deduction";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Superadmin only - the page renders it, the action enforces it. */
export function DeductCreditButton({
  trackingCode,
  partnerLabel,
  balanceUsd,
}: {
  trackingCode: string;
  partnerLabel: string;
  balanceUsd: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Starts empty, unlike the portal's convert: the default must never be the
  // whole balance.
  const [amount, setAmount] = useState("");

  const amountNumber = Number(amount);
  const problem = deductionProblem(amountNumber, balanceUsd);

  const handleDeduct = async () => {
    setBusy(true);
    try {
      const result = await deductPartnerCredit(trackingCode, amountNumber);
      if (!result.ok) {
        // Keep the dialog open so the amount can be corrected.
        toast({ variant: "destructive", title: "לא הצלחנו להוריד", description: result.error });
        return;
      }
      toast({
        title: "הצבירה עודכנה",
        description: `ירדו ${usd.format(result.amountUsd)} ל${partnerLabel}. היתרה: ${usd.format(result.balanceUsd)}.`,
      });
      setOpen(false);
      setAmount("");
      router.refresh();
    } catch (error) {
      console.error("deductPartnerCredit:", error);
      toast({
        variant: "destructive",
        title: "לא הצלחנו להוריד",
        description: "אירעה שגיאה. נסו שוב.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        הורד מהצבירה
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">
              הורדה מהצבירה של {partnerLabel}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              יתרה נוכחית: {usd.format(balanceUsd)}. אחרי האישור אי אפשר לבטל מכאן, אז
              בדקו את הסכום.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="deduct-amount">סכום להורדה ($)</Label>
            <Input
              id="deduct-amount"
              type="number"
              min={MIN_DEDUCT_USD}
              max={balanceUsd}
              // Cents, not whole dollars - a balance can be $62.50.
              step="0.01"
              dir="ltr"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amount !== "" && problem && (
              <p className="text-xs text-destructive">{problem}</p>
            )}
            {!problem && (
              <p className="text-sm text-muted-foreground">
                היתרה תרד מ-{usd.format(balanceUsd)} ל-
                {usd.format(balanceUsd - amountNumber)}.
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !!problem}
              onClick={(e) => {
                // Keep the dialog open on failure so the input can be fixed.
                e.preventDefault();
                handleDeduct();
              }}
            >
              {busy ? "מוריד..." : "הורד"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
