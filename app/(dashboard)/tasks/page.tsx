import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TasksClient } from "./tasks-client";

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="The team's work queue - admins create and assign, everyone works their own list. The Creative gaps tab lists every visual asset still missing on the site and turns any of them into a task in one click."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TasksClient />
      </Suspense>
    </div>
  );
}
