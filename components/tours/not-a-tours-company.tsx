import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** How to reach another company - one wording for every card that depends on the active company. */
export const SWITCH_COMPANY_HINT = "Switch company in the company switcher in the top bar.";

/**
 * A tours screen the viewer may not open, said in a card instead of a crash:
 * why it is closed, and the way back. One card for every refusal of the tours
 * pages (wrong company, wrong role).
 */
export function AccessNotice({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: ReactNode;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Shown by a tours page when the active company does not sell tours (Mega
 * Events). `description` says what the screen needs, in the page's own words;
 * the card adds how to switch company (SWITCH_COMPANY_HINT), so the page does not.
 */
export function NotAToursCompany({ description }: { description: ReactNode }) {
  return (
    <AccessNotice
      title="This screen belongs to a tours company"
      description={
        <>
          {description} {SWITCH_COMPANY_HINT}
        </>
      }
      backHref="/dashboard"
      backLabel="Back to Dashboard"
    />
  );
}
