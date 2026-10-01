"use client";

import { useState, useEffect } from "react";
import { CalendarDays, Users, ClipboardList, UserCheck, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { StatCard } from "@/components/dashboard/stat-card";

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
      <StatCard label="Events" value={loading ? "..." : counts.events} hint="In 7+ days" icon={CalendarDays} />
      <StatCard label="Agents" value={loading ? "..." : counts.agents} hint="Partner type agent" icon={UserCheck} />
      <StatCard label="Partners" value={loading ? "..." : counts.partners} hint="Affiliates (filtered)" icon={Users} />
      <StatCard label="Paid Reservations" value={loading ? "..." : counts.paidReservations} hint="Status Paid" icon={ClipboardList} />
      <StatCard label="Pending Reservations" value={loading ? "..." : counts.pendingReservations} hint="Status Pending" icon={UserPlus} />
    </div>
  );
}
