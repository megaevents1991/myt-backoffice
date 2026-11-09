"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUrlState } from "@/hooks/use-view-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getClubPage } from "@/lib/actions/club-actions";
import { CLUB_RANGES, type ClubRange } from "@/lib/club/stats";
import { OverviewTab } from "./overview-tab";
import { MembersTab } from "./members-tab";
import { SettingsTab } from "./settings-tab";

const TAB_IDS = ["overview", "members", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];
const RANGE_LABEL: Record<ClubRange, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "Since the start" };

export type ClubPageData = Extract<Awaited<ReturnType<typeof getClubPage>>, { ok: true }>;

export function ClubClient() {
  const [tab, setTab] = useUrlState<TabId>("tab", "overview", TAB_IDS);
  const [range, setRange] = useUrlState<ClubRange>("range", "30d", CLUB_RANGES);
  const [data, setData] = useState<ClubPageData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await getClubPage(range);
    if (mine !== seq.current) return;
    if (res.ok) {
      setData(res);
      setProblem(null);
    } else {
      setProblem(
        res.kind === "not_ready"
          ? "The members club is not set up in the database yet (the migration has not run)."
          : `Could not load the club: ${res.message ?? res.kind}`,
      );
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members{data ? ` (${data.members.length})` : ""}</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        {tab === "overview" && (
          <Select value={range} onValueChange={(v) => setRange(v as ClubRange)}>
            <SelectTrigger className="w-44" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {RANGE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {problem && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{problem}</p>}
      {!data && !problem && <Skeleton className="mt-4 h-64 w-full" />}

      {data && (
        <>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab data={data} />
          </TabsContent>
          <TabsContent value="members" className="mt-4">
            <MembersTab members={data.members} onChanged={load} />
          </TabsContent>
          <TabsContent value="settings" className="mt-4">
            <SettingsTab settings={data.settings} onSaved={load} />
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}
