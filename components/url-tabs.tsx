"use client";

import type { ComponentProps } from "react";

import { Tabs } from "@/components/ui/tabs";
import { useUrlState } from "@/hooks/use-view-state";

interface UrlTabsProps
  extends Omit<ComponentProps<typeof Tabs>, "value" | "defaultValue"> {
  /** The tab shown when the URL names none - it is never written to the URL. */
  defaultValue: string;
  /** Query param that carries the tab. */
  param?: string;
  /** The tabs that exist - anything else in the URL opens the default. */
  values?: readonly string[];
}

/**
 * <Tabs> whose open tab lives in the URL (`?tab=kanban`), so a refresh, Back and
 * a pasted link all land on the tab you were on. Same children as <Tabs>
 * (TabsList / TabsTrigger / TabsContent). Use it for a screen's MAIN tabs; a
 * small tab strip inside a dialog or an editor stays a plain <Tabs>.
 */
export function UrlTabs({
  defaultValue,
  param = "tab",
  values,
  onValueChange,
  ...props
}: UrlTabsProps) {
  const [tab, setTab] = useUrlState(param, defaultValue, values);

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        setTab(next);
        onValueChange?.(next);
      }}
      {...props}
    />
  );
}
