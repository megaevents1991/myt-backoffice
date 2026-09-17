"use client";

// The four-tab shell. Each tab's body is rendered server-side (page.tsx) and handed in as a
// plain ReactNode - this component only owns which tab is showing.
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AgentTabs({
  defaultTab,
  identity,
  memory,
  log,
  maturity,
}: {
  defaultTab: string;
  identity: ReactNode;
  memory: ReactNode;
  log: ReactNode;
  maturity: ReactNode;
}) {
  return (
    <Tabs defaultValue={defaultTab} dir="rtl">
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
    </Tabs>
  );
}
