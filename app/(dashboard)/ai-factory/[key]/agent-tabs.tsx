"use client";

// The four-tab shell. Each tab's body is rendered server-side (page.tsx) and handed in as a
// plain ReactNode - this component only owns which tab is showing.
import type { ReactNode } from "react";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/url-tabs";

export function AgentTabs({
  identity,
  memory,
  log,
  maturity,
}: {
  identity: ReactNode;
  memory: ReactNode;
  log: ReactNode;
  maturity: ReactNode;
}) {
  return (
    // The open tab lives in `?tab=`: it used to be read on arrival and never written on a
    // click, so a refresh on "יומן" landed back on "זהות".
    <UrlTabs
      defaultValue="identity"
      values={["identity", "memory", "log", "maturity"]}
      dir="rtl"
    >
      <TabsList>
        <TabsTrigger value="identity">זהות</TabsTrigger>
        <TabsTrigger value="memory">זיכרון ולימוד</TabsTrigger>
        <TabsTrigger value="log">יומן</TabsTrigger>
        <TabsTrigger value="maturity">בשלות</TabsTrigger>
      </TabsList>
      <TabsContent value="identity" className="pt-4">{identity}</TabsContent>
      <TabsContent value="memory" className="pt-4">{memory}</TabsContent>
      <TabsContent value="log" className="pt-4">{log}</TabsContent>
      <TabsContent value="maturity" className="pt-4">{maturity}</TabsContent>
    </UrlTabs>
  );
}
