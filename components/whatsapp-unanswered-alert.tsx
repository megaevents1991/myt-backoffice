"use client";

/**
 * The dashboard banner of Mega Events' WhatsApp (spec 2026-11-08 B-6): shown only while some chat has waited 60+
 * working minutes for an answer, with a link to that filter on the WhatsApp screen. A failed read shows nothing.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getUnansweredCount } from "@/lib/actions/whatsapp-events-actions";

export function WhatsappUnansweredAlert() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void getUnansweredCount().then((res) => setCount(res.success ? res.data?.count ?? 0 : null));
  }, []);
  if (!count) return null;
  return (
    <Alert variant="destructive" className="bg-destructive/5">
      <MessageCircle className="h-4 w-4" />
      <AlertTitle dir="rtl">{count === 1 ? "שיחת וואטסאפ אחת מחכה לתשובה" : `${count} שיחות וואטסאפ מחכות לתשובה`}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p dir="rtl">יותר משעת עבודה בלי מענה.</p>
        <Button asChild size="sm" variant="outline" className="bg-background text-foreground">
          <Link href="/whatsapp?f=unanswered">לשיחות</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
