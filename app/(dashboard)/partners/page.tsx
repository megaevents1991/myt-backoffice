import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPartnersOverview } from "@/lib/actions/partners-dashboard-actions";
import type { InsightsRange } from "@/lib/actions/partner-performance-actions";
import { AddPartnerButton } from "./add-partner-button";
import { PartnersInsights, INSIGHTS_RANGE_OPTIONS } from "./partners-insights";
import { PartnersTable } from "./partners-table";

export const dynamic = "force-dynamic";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range: InsightsRange = INSIGHTS_RANGE_OPTIONS.some((o) => o.key === rangeParam)
    ? (rangeParam as InsightsRange)
    : "90d";

  const overview = await getPartnersOverview(range);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partners"
        description="Agencies, affiliates and offices that send you customers - each with a tracking code, commission terms and the discount their followers get. Production first; the full list and terms are one tab over."
        actions={<AddPartnerButton />}
      />

      <Tabs defaultValue="insights">
        <TabsList>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="list">Partners list</TabsTrigger>
        </TabsList>
        <TabsContent value="insights" className="mt-4">
          <PartnersInsights overview={overview} range={range} />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
          <PartnersTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
