"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { saveClubSettings } from "@/lib/actions/club-actions";
import { CLUB_AMOUNT_MAX, CLUB_AMOUNT_MIN } from "@/lib/club/settings";
import type { ClubSettings } from "@/lib/club/types";

export function SettingsTab({ settings, onSaved }: { settings: ClubSettings; onSaved: () => void }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [amount, setAmount] = useState(String(settings.discount_per_traveler_usd));
  const [busy, setBusy] = useState(false);

  const changed =
    enabled !== settings.enabled || Number(amount) !== settings.discount_per_traveler_usd;

  async function save() {
    setBusy(true);
    // popup_delay_seconds stays stored as it is: the club has no popup any more (spec D16), the key stays valid.
    const res = await saveClubSettings({
      enabled,
      discount_per_traveler_usd: Number(amount),
      popup_delay_seconds: settings.popup_delay_seconds,
    });
    setBusy(false);
    if (!res.ok) {
      toast({ variant: "destructive", title: "Not saved", description: res.message ?? res.kind });
      return;
    }
    const parts: string[] = [];
    if (res.settings.enabled !== settings.enabled) parts.push(res.settings.enabled ? "the club is on" : "the club is off");
    if (res.settings.discount_per_traveler_usd !== settings.discount_per_traveler_usd) {
      parts.push(`$${res.settings.discount_per_traveler_usd} per traveler on ${res.codesUpdated} member codes`);
    }
    toast({ title: "Saved", description: parts.join(" · ") || "Nothing changed." });
    onSaved();
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">MEGA CLUB on the site</CardTitle>
        <CardDescription>Changes reach the site within a minute.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="club-enabled">Club on the order summary</Label>
            <p className="text-sm text-muted-foreground">
              Off = the old discount popup comes back and every club surface leaves the site. Member codes typed into the coupon field
              keep working.
            </p>
          </div>
          <Switch id="club-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="club-amount">Member price, $ per traveler</Label>
            <Input
              id="club-amount"
              type="number"
              inputMode="numeric"
              min={CLUB_AMOUNT_MIN}
              max={CLUB_AMOUNT_MAX}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Whole dollars, {CLUB_AMOUNT_MIN} to {CLUB_AMOUNT_MAX}. Saving updates every member&apos;s code at once.
            </p>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground sm:pt-6">
            On the order summary the club is a card above the payment button: &quot;join free and save $X on this
            order&quot; with one consent box - no popup. The amount shown is this one times the order&apos;s tickets.
          </div>
        </div>
        <Button onClick={save} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
