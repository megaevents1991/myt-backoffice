"use client";

import { UrlTabs } from "@/components/url-tabs";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExecTab } from "./exec-tab";
import { MediaTab } from "./media-tab";
import { InstagramTab } from "./instagram-tab";
import { AlertsTab } from "./alerts-tab";
import { SettingsTab } from "./settings-tab";

const TAB_IDS = ["exec", "media", "instagram", "alerts", "settings"] as const;

export function MarketingClient() {
  return (
    <UrlTabs defaultValue="exec" values={TAB_IDS}>
      <TabsList>
        <TabsTrigger value="exec">הנהלה</TabsTrigger>
        <TabsTrigger value="media">מדיה</TabsTrigger>
        <TabsTrigger value="instagram">אינסטגרם</TabsTrigger>
        <TabsTrigger value="alerts">התראות</TabsTrigger>
        <TabsTrigger value="settings">הגדרות</TabsTrigger>
      </TabsList>
      <TabsContent value="exec" className="mt-4"><ExecTab /></TabsContent>
      <TabsContent value="media" className="mt-4"><MediaTab /></TabsContent>
      <TabsContent value="instagram" className="mt-4"><InstagramTab /></TabsContent>
      <TabsContent value="alerts" className="mt-4"><AlertsTab /></TabsContent>
      <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
    </UrlTabs>
  );
}
