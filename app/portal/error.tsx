"use client";

/**
 * Portal-wide error boundary. Guard denials (e.g. a user disabled mid-session
 * whose cookie is still valid) surface as thrown "Unauthorized" errors from
 * server actions - without this boundary they render as a raw 500. Shown
 * inside the portal layout, so the brand chrome stays.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>משהו השתבש</CardTitle>
          <CardDescription>
            לא הצלחנו לטעון את העמוד. ייתכן שאין לחשבון הרשאה לצפות בו, או
            שהחשבון הושבת. אם זה נמשך - פנו אלינו.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={reset}>ניסיון נוסף</Button>
          <Button variant="outline" asChild>
            <Link href="/portal">חזרה לדשבורד</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
