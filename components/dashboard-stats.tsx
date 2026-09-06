"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getDashboardStats } from "@/lib/actions/dashboard-actions";

type TopItem = { label: string; count: number };

function TopListCard({ title, items, loading }: { title: string; items: TopItem[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          <ul className="text-xs space-y-1">
            {items.map((it) => (
              <li key={it.label} className="flex justify-between">
                <span className="truncate max-w-[70%]" title={it.label}>{it.label}</span>
                <span className="font-medium">{it.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardStats() {
  const [stats, setStats] = useState({
    totalRevenue: 0,
    topPartnerCommission: 0,
    recentReservations: 0,
    recentReservationsPax: 0,
    reservationsLastMonth: 0,
    paxLastMonth: 0,
    reservationsLast7Days: 0,
    paxLast7Days: 0,
    reservationsCurrentMonth: 0,
    paxCurrentMonth: 0,
    topEventsLast30: [] as TopItem[],
    topEventsThisMonth: [] as TopItem[],
    topEventsLastMonth: [] as TopItem[],
    topSourcesLast30: [] as TopItem[],
    topSourcesThisMonth: [] as TopItem[],
    topSourcesLastMonth: [] as TopItem[],
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchStats() {
      try {
        const data = await getDashboardStats();
        setStats(data);
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load dashboard statistics. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [toast]);

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold tabular-nums tracking-tight">
              $
              {loading
                ? "..."
                : stats.totalRevenue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </div>
            <p className="text-xs text-muted-foreground">From all reservations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Reservations Last Month</CardTitle>
          </CardHeader>
            <CardContent>
              <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : stats.reservationsLastMonth}</div>
              <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.paxLastMonth}</p>
            </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Reservations This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : stats.reservationsCurrentMonth}</div>
            <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.paxCurrentMonth}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Reservations Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : stats.reservationsLast7Days}</div>
            <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.paxLast7Days}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Reservations Last 30 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : stats.recentReservations}</div>
            <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.recentReservationsPax}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Lists */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <TopListCard title="Top Events (30d)" items={stats.topEventsLast30} loading={loading} />
        <TopListCard title="Top Events (This Month)" items={stats.topEventsThisMonth} loading={loading} />
        <TopListCard title="Top Events (Last Month)" items={stats.topEventsLastMonth} loading={loading} />
        <TopListCard title="Top Sources (30d)" items={stats.topSourcesLast30} loading={loading} />
        <TopListCard title="Top Sources (This Month)" items={stats.topSourcesThisMonth} loading={loading} />
        <TopListCard title="Top Sources (Last Month)" items={stats.topSourcesLastMonth} loading={loading} />
      </div>
    </div>
  );
}
