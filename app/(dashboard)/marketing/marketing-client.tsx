"use client";

import { useUrlState } from "@/hooks/use-view-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExecTab } from "./exec-tab";
import { SalesTab } from "./sales-tab";
import { MediaTab } from "./media-tab";
import { TrafficTab } from "./traffic-tab";
import { InfluencersTab } from "./influencers-tab";
import { TimeLagTab } from "./time-lag-tab";
import { InstagramTab } from "./instagram-tab";
import { AlertsTab } from "./alerts-tab";
import { SettingsTab } from "./settings-tab";
import { MarketingFilterBar, MarketingFiltersProvider } from "./marketing-shared";

const TAB_IDS = ["exec", "sales", "media", "traffic", "influencers", "timelag", "instagram", "alerts", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];

/** Tabs the source filter means nothing to (the bar hides that select there) - Influencers are partners by definition. */
const NO_SOURCE: readonly TabId[] = ["influencers", "instagram", "alerts"];

export function MarketingClient() {
  const [tab, setTab] = useUrlState<TabId>("tab", "exec", TAB_IDS);
  return (
    <MarketingFiltersProvider>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="exec">Executive</TabsTrigger>
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="traffic">Traffic</TabsTrigger>
            <TabsTrigger value="influencers">Influencers</TabsTrigger>
            <TabsTrigger value="timelag">Time to purchase</TabsTrigger>
            <TabsTrigger value="instagram">Instagram</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          {tab !== "settings" && <MarketingFilterBar showSource={!NO_SOURCE.includes(tab)} />}
        </div>
        <TabsContent value="exec" className="mt-4"><ExecTab /></TabsContent>
        <TabsContent value="sales" className="mt-4"><SalesTab /></TabsContent>
        <TabsContent value="media" className="mt-4"><MediaTab /></TabsContent>
        <TabsContent value="traffic" className="mt-4"><TrafficTab /></TabsContent>
        <TabsContent value="influencers" className="mt-4"><InfluencersTab /></TabsContent>
        <TabsContent value="timelag" className="mt-4"><TimeLagTab /></TabsContent>
        <TabsContent value="instagram" className="mt-4"><InstagramTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><AlertsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
      </Tabs>
    </MarketingFiltersProvider>
  );
}
