"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Users, ClipboardList, UserCheck, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getDashboardCounts } from "@/lib/actions/dashboard-actions";

export function DashboardCards() {
  const [counts, setCounts] = useState({
    events: 0,
    agents: 0,
    partners: 0,
    paidReservations: 0,
    pendingReservations: 0,
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchCounts() {
      try {
        // Update to use fetch API instead of direct server action
        const response = await fetch("/api/dashboard/counts");
        if (!response.ok) {
          throw new Error("Failed to fetch dashboard counts");
        }
        const data = await response.json();
        setCounts(data);
      } catch (error) {
        console.error("Error fetching dashboard counts:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load dashboard counts. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchCounts();
  }, [toast]);

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
      {/* Events (>= 1 week from now) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Events</CardTitle>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : counts.events}</div>
          <p className="text-xs text-muted-foreground">In 7+ days</p>
        </CardContent>
      </Card>

      {/* Agents */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Agents</CardTitle>
          <UserCheck className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : counts.agents}</div>
          <p className="text-xs text-muted-foreground">Partner type agent</p>
        </CardContent>
      </Card>

      {/* Partners (Affiliates filtered) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Partners</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : counts.partners}</div>
          <p className="text-xs text-muted-foreground">Affiliates (filtered)</p>
        </CardContent>
      </Card>

      {/* Paid Reservations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Paid Reservations</CardTitle>
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : counts.paidReservations}</div>
          <p className="text-xs text-muted-foreground">Status Paid</p>
        </CardContent>
      </Card>

      {/* Pending Reservations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Reservations</CardTitle>
          <UserPlus className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{loading ? "..." : counts.pendingReservations}</div>
          <p className="text-xs text-muted-foreground">Status Pending</p>
        </CardContent>
      </Card>
    </div>
  );
}
