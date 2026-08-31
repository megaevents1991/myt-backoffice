"use client";

import { Suspense, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardCards } from "@/components/dashboard-cards";
import { DashboardStats } from "@/components/dashboard-stats";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ReservationsTrend } from "@/components/reservations-trend";

export default function Dashboard() {
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Add window level error handler
    const handleError = (event: ErrorEvent) => {
      console.error("Caught in error handler:", event.error);
      setError(event.error);
      toast({
        variant: "destructive",
        title: "An error occurred",
        description: event.error?.message || "Unknown error",
      });
    };

    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("error", handleError);
    };
  }, [toast]);

  if (error) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <h2 className="text-xl font-bold text-red-700 dark:text-red-400">
          Error Loading Dashboard
        </h2>
        <pre className="mt-4 p-4 bg-muted rounded overflow-auto">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Manage your events, partners, and reservations.
        </p>
      </div>

      {/* Cards Section */}
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardCards />
      </Suspense>

      {/* Statistics Section */}
      <h2 className="text-xl font-semibold tracking-tight mt-8">Statistics</h2>
      <Suspense fallback={<DashboardStatsSkeleton />}>
        <DashboardStats />
      </Suspense>

      {/* Reservations Trend */}
      <ReservationsTrend />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <Skeleton className="h-4 w-24" />
            </CardTitle>
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-12 mb-1" />
            <Skeleton className="h-4 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DashboardStatsSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              <Skeleton className="h-4 w-32" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-24 mb-1" />
            <Skeleton className="h-4 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
