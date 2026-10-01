import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Shown to a staff member of the company who is not its manager. */
export function ManagersOnly() {
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Managers only</CardTitle>
          <CardDescription>
            This screen gathers the approvals and decisions only the company manager makes. Day-to-day work
            goes on from the Tours board and Offline Flights.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/tours">Back to Overview</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
