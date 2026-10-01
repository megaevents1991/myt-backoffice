import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown by a tours page when the active company does not sell tours (Mega
 * Events): the guard's refusal said in a card, instead of a crash.
 * `description` says what the screen needs, in the page's own words.
 */
export function NotAToursCompany({ description }: { description: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">This screen belongs to a tours company</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
