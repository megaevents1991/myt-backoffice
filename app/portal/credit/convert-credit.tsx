"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { convertCreditToCoupon } from "@/lib/actions/partner-credit-actions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function ConvertCredit({ balanceUsd }: { balanceUsd: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; amountUsd: number } | null>(null);

  const handleConvert = async () => {
    setBusy(true);
    try {
      const result = await convertCreditToCoupon();
      if (!result.ok) {
        toast({ variant: "destructive", title: "לא הצלחנו להמיר", description: result.error });
        return;
      }
      setIssued({ code: result.code, amountUsd: result.amountUsd });
      router.refresh();
    } catch (error) {
      console.error("convertCreditToCoupon:", error);
      toast({
        variant: "destructive",
        title: "לא הצלחנו להמיר",
        description: "אירעה שגיאה. נסו שוב.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">הקופון שלכם מוכן</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-wider">{issued.code}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          בשווי {usd.format(issued.amountUsd)} · לשימוש חד-פעמי
        </p>
      </div>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={busy || balanceUsd <= 0}>
          {busy ? "ממיר..." : "המרה לקופון"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>להמיר {usd.format(balanceUsd)} לקופון?</AlertDialogTitle>
          <AlertDialogDescription>
            נפיק קופון חד-פעמי בשווי {usd.format(balanceUsd)}. הצבירה תתאפס, והקופון
            יישאר פעיל עד שתשתמשו בו. לא ניתן לבטל את הפעולה.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={handleConvert}>המרה לקופון</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
