import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHotelsReport } from "@/lib/actions/form-hotels-actions";
import { HotelsClient } from "./hotels-client";

export const dynamic = "force-dynamic";

/** Every hotel question of every feedback form, rolled up per hotel - the weakest first. */
export default async function FormHotelsPage() {
  const report = await getHotelsReport();

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
          <Link href="/forms">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All forms
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Hotels report</h1>
        <p className="text-muted-foreground">
          How travellers rated each hotel, across every series that sleeps there - the
          weakest first. Open a hotel to read the low answers and what they wrote.
        </p>
      </div>

      <HotelsClient report={report} />
    </div>
  );
}
