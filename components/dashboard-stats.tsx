"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { getDashboardStats } from "@/lib/actions/dashboard-actions";
import { StatCard } from "@/components/dashboard/stat-card";
import { TopListCard, type TopItem } from "@/components/dashboard/top-list-card";

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
        {/* Not revenue: getDashboardStats' `totalRevenue` is $175 (the site
            markup) per traveller on every Paid booking - an estimated margin. */}
        <StatCard
          label="Est. Margin"
          value={`$${
            loading
              ? "..."
              : stats.totalRevenue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
          }`}
          hint="$175 × travellers, Paid bookings"
        />
        <StatCard
          label="Reservations Last Month"
          value={loading ? "..." : stats.reservationsLastMonth}
          hint={`PAX: ${loading ? "..." : stats.paxLastMonth}`}
        />
        <StatCard
          label="Reservations This Month"
          value={loading ? "..." : stats.reservationsCurrentMonth}
          hint={`PAX: ${loading ? "..." : stats.paxCurrentMonth}`}
        />
        <StatCard
          label="Reservations Last 7 Days"
          value={loading ? "..." : stats.reservationsLast7Days}
          hint={`PAX: ${loading ? "..." : stats.paxLast7Days}`}
        />
        <StatCard
          label="Reservations Last 30 Days"
          value={loading ? "..." : stats.recentReservations}
          hint={`PAX: ${loading ? "..." : stats.recentReservationsPax}`}
        />
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
