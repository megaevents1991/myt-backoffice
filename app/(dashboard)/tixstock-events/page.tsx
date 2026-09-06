import { Suspense } from "react";
import { TixStockEventsContent } from "./tixstock-events-content";
import { Skeleton } from "@/components/ui/skeleton";

export default function TixStockEventsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">TixStock Events</h1>
          <p className="text-muted-foreground">
            Browse and manage events from TixStock provider.
          </p>
        </div>
      </div>

      <Suspense fallback={<TixStockEventsPageSkeleton />}>
        <TixStockEventsContent />
      </Suspense>
    </div>
  );
}

function TixStockEventsPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Sync Status Card Skeleton */}
      <div className="p-6 bg-card rounded-lg border">
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-4 w-64 mb-4" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {/* Main Content Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-6 bg-card rounded-lg border">
            <Skeleton className="h-6 w-24 mb-4" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
            <Skeleton className="h-4 w-32 mt-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
