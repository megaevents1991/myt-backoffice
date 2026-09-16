"use client";

/**
 * Dashboard-wide error boundary. Server-side guard denials (e.g. an editor
 * opening an admin-only page like /price-light by URL - `requireAdmin()` throws
 * "Unauthorized") and load failures land here instead of Next's bare
 * "Application error" page. Shown inside the dashboard layout, so the sidebar
 * stays. In production Next replaces a server error's message with a generic
 * one, so the copy covers both cases rather than guessing which it was.
 */

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error boundary:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>משהו השתבש</CardTitle>
          <CardDescription>
            לא הצלחנו לטעון את העמוד. ייתכן שאין לחשבון שלך הרשאה לצפות בו. אם
            זה נמשך - פנו למנהל המערכת.
          </CardDescription>
          {error.digest && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              ref: {error.digest}
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={reset}>ניסיון נוסף</Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">חזרה לדשבורד</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
