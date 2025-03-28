"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Users, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getDashboardCounts } from "@/lib/actions/dashboard-actions";

export function DashboardCards() {
  const [counts, setCounts] = useState({
    events: 0,
    partners: 0,
    reservations: 0,
    upcomingEvents: 0,
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
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Events</CardTitle>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {loading ? "..." : counts.upcomingEvents}
          </div>
          <p className="text-xs text-muted-foreground">Upcoming events</p>
          <div className="mt-3 text-sm text-muted-foreground">
            {loading ? "..." : counts.events} total events
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Partners</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {loading ? "..." : counts.partners}
          </div>
          <p className="text-xs text-muted-foreground">Active partners</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Reservations</CardTitle>
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {loading ? "..." : counts.reservations}
          </div>
          <p className="text-xs text-muted-foreground">Total reservations</p>
        </CardContent>
      </Card>
    </div>
  );
}
