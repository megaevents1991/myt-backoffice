import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TasksClient } from "./tasks-client";

export default function TasksPage() {
  return (
    // One short line of heading: this screen's boards (Kanban above all) need the
    // height on a laptop - what each tab holds is in the Guide. `mb-0` because the
    // wrapper's own gap already separates the heading from the board pills.
    <div className="space-y-4">
      <PageHeader
        title="Tasks"
        description="The team's work queue - admins assign, everyone works their own list."
        className="mb-0"
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TasksClient />
      </Suspense>
    </div>
  );
}
