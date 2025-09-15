"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getDashboardStats } from "@/lib/actions/dashboard-actions";

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
  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
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

      {/* Reservations Last Month */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Reservations Last Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{loading ? "..." : stats.reservationsLastMonth}</div>
          <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.paxLastMonth}</p>
        </CardContent>
      </Card>

      {/* Reservations Last 7 Days */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Reservations Last 7 Days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{loading ? "..." : stats.reservationsLast7Days}</div>
          <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.paxLast7Days}</p>
        </CardContent>
      </Card>

      {/* Recent Reservations (last 30 days) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Reservations Last 30 Days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{loading ? "..." : stats.recentReservations}</div>
          <p className="text-xs text-muted-foreground">PAX: {loading ? "..." : stats.recentReservationsPax}</p>
        </CardContent>
      </Card>
    </div>
  );
}
