import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getActiveCompany } from "@/lib/company";
import { hasEventsTaskBoard } from "@/lib/services/task-company";
import { TasksClient } from "./tasks-client";

// The board is per company (lib/tasks-scope.ts). The active company is resolved HERE, on the
// server, so the screen never paints the Mega Events tabs for a company that does not have
// them: a company that sells no events gets the plain board (lib/services/task-company.ts).
// It only decides what is drawn - every action re-resolves the company itself.
export default async function TasksPage() {
  const company = await getActiveCompany();
  const plainBoard = !hasEventsTaskBoard(company);
  return (
    // One short line of heading: this screen's boards (Kanban above all) need the
    // height on a laptop - what each tab holds is in the Guide. `mb-0` because the
    // wrapper's own gap already separates the heading from the board pills.
    <div className="space-y-4">
      {plainBoard ? (
        <div dir="rtl">
          <PageHeader
            title="משימות"
            description={`לוח המשימות של ${company.name} - מנהל משייך, וכל אחד עובד על הרשימה שלו.`}
            className="mb-0"
          />
        </div>
      ) : (
        <PageHeader
          title="Tasks"
          description="The team's work queue - admins assign, everyone works their own list."
          className="mb-0"
        />
      )}
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TasksClient plainBoard={plainBoard} />
      </Suspense>
    </div>
  );
}
