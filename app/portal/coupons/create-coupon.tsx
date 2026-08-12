"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgePercent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { createPartnerCoupon } from "@/lib/actions/portal-coupon-actions";
import type { MyCouponTerms } from "@/lib/actions/portal-coupon-actions";

/** Create a commission-funded coupon. The unit follows the partner's
 *  commission type; the value is capped at their rate - both enforced again
 *  server-side. */
export function CreateCoupon({ terms }: { terms: MyCouponTerms }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [maxUses, setMaxUses] = useState("1");

  const isPercent = terms.type === "percent_of_sale";
  const capLabel = isPercent ? `${terms.cap}%` : `$${terms.cap}`;

  if (!Number.isFinite(terms.cap) || terms.cap <= 0) return null;

  const submit = () => {
    startTransition(async () => {
      const result = await createPartnerCoupon({
        discount_type: isPercent ? "percent" : "fixed",
        discount_value: Number(value),
        code: code || null,
        valid_until: validUntil || null,
        max_uses: maxUses ? Number(maxUses) : 1,
      });
      if (result.ok) {
        toast({ title: "הקופון נוצר", description: `קוד: ${result.code}` });
        setValue("");
        setCode("");
        setValidUntil("");
        setMaxUses("1");
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgePercent className="h-4 w-4 text-muted-foreground" />
          קופון הנחה על חשבון העמלה
        </CardTitle>
        <CardDescription>
          תנו ללקוח הנחה נוספת כשהוא משלם באתר - עד התקרה שבהסכם שלכם ({capLabel}
          {isPercent ? "" : " לכרטיס"}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          שימו לב: ההנחה שהקופון נותן מקוזזת מהעמלה שלכם על אותה הזמנה בהתחשבנות.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">
              {isPercent ? "אחוז הנחה" : "סכום הנחה ($)"}
            </span>
            <Input
              type="number"
              min={1}
              max={terms.cap}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`עד ${terms.cap}`}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">שם קופון (לא חובה)</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="נוצר אוטומטית"
              dir="ltr"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">בתוקף עד (לא חובה)</span>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">מספר שימושים</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </label>
        </div>
        <Button onClick={submit} disabled={isPending || !value}>
          {isPending ? "יוצר..." : "צרו קופון"}
        </Button>
      </CardContent>
    </Card>
  );
}
