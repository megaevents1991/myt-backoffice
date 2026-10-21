import { PageHeader } from "@/components/page-header";
import { listRuns } from "@/lib/actions/uploader-actions";
import { agentEnabled, TOUR_UPLOADER_AGENT } from "@/lib/agents";
import { requireAdmin } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { BRIEF_MAX } from "@/lib/uploader/run-rules";
import { UploaderClient } from "./uploader-client";

// The tour uploader's entry screen (agent #3): a free-text brief, the plan it parses into
// ("מה הבנתי"), and the runs already made. Spec docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md
// §5.1-5.2. The board of one run is /uploader/[id].
//
// parseBrief may spend a model call (the agent's own 20 s timeout) before it searches the
// suppliers' catalogs; the platform default could cut that off mid-parse. Same 60 s the board gets.
export const maxDuration = 60;

// Admin-only (requireAdmin throws for anyone else - the route's error boundary renders instead),
// like /ai-factory and /price-light: hiding the menu item is not the guard.
export default async function UploaderPage() {
  await requireAdmin();
  const agentOn = agentEnabled(TOUR_UPLOADER_AGENT);
  const runs = await listRuns();

  return (
    <div dir="rtl" className="container mx-auto max-w-5xl space-y-8 py-10">
      <PageHeader
        className="mb-0"
        title="AI Uploader"
        description="כתבו מה להעלות - הסוכן מפענח את הבריף לתוכנית, אתם מאשרים אותה, והאירועים נבנים מוסתרים לבדיקה לפני שהם עולים לאתר."
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              agentOn ? "bg-success-muted text-success" : "bg-muted text-muted-foreground",
            )}
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", agentOn ? "bg-success" : "bg-muted-foreground/60")} />
            {agentOn ? "הסוכן פעיל" : "הסוכן כבוי"}
          </span>
        }
      />
      <UploaderClient runs={runs} agentOn={agentOn} briefMax={BRIEF_MAX} />
    </div>
  );
}
