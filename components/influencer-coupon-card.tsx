"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  createInfluencerCoupon,
  getInfluencerCoupon,
} from "@/lib/actions/influencer-coupon-actions";
import {
  influencerCouponCode,
  influencerCouponTerms,
  type InfluencerCoupon,
} from "@/lib/services/influencer-coupon";

/**
 * The partner editor's "Influencer coupon" box (affiliates only, existing
 * partners only). Shows the one coupon built from the follower discount, or
 * the button that builds it. Saving the partner re-syncs the coupon on its
 * own; this box only covers first creation and a manual re-sync.
 */
export function InfluencerCouponCard({
  trackingCode,
  userDiscount,
}: {
  trackingCode: string;
  /** The form's current (possibly unsaved) follower discount. */
  userDiscount: number;
}) {
  const { toast } = useToast();
  const [coupon, setCoupon] = useState<InfluencerCoupon | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getInfluencerCoupon(trackingCode).then(setCoupon);
  }, [trackingCode]);

  const terms = influencerCouponTerms(userDiscount);
  const previewCode = terms ? influencerCouponCode(trackingCode, terms.discount_value) : null;
  const unsaved = coupon && previewCode && coupon.code !== previewCode;

  const build = async () => {
    setBusy(true);
    try {
      const result = await createInfluencerCoupon(trackingCode);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Coupon", description: result.error });
        return;
      }
      setCoupon(result.coupon);
      toast({
        title: result.created ? "Influencer coupon created" : "Influencer coupon updated",
        description: result.coupon.code,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!coupon) return;
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Ticket className="h-4 w-4 text-muted-foreground" />
            Influencer coupon
          </div>
          {coupon === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : coupon ? (
            <>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm font-semibold">
                  {coupon.code}
                </code>
                <Button type="button" variant="ghost" size="sm" onClick={copy} className="h-7 px-2">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                {!coupon.is_active && (
                  <span className="text-xs text-destructive">inactive</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {coupon.discount_type === "percent"
                  ? `${coupon.discount_value}% off the order`
                  : `$${coupon.discount_value} off per person`}
                {" · "}
                {coupon.times_used} used, {coupon.times_paid ?? 0} paid. Orders with this
                code count as this partner&apos;s.
              </p>
              {unsaved && (
                <p className="text-xs text-warning">
                  Follower discount changed - saving the partner renames the coupon to{" "}
                  <span className="font-mono">{previewCode}</span>.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {previewCode
                ? `Builds ${previewCode} from the follower discount: followers who type the code instead of clicking the link still count as this partner's orders.`
                : "Set a follower discount first - the coupon is built from it."}
            </p>
          )}
        </div>
        {coupon !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || (!coupon && !previewCode)}
            onClick={build}
            className="shrink-0"
          >
            {busy ? "Working…" : coupon ? "Re-sync" : "Create coupon"}
          </Button>
        )}
      </div>
    </div>
  );
}
