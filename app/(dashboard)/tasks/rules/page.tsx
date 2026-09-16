import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/guards";
import { listTaskRules } from "@/lib/actions/task-rule-actions";
import { listStaffForMentions } from "@/lib/actions/task-comment-actions";
import { RulesClient } from "./rules-client";

// Admin-only screen (lib/nav.ts roles: ADMIN_ROLES) - refused here too, server-side,
// so a non-admin hitting the URL directly (not just the hidden nav item) never sees
// the list. requireAdmin() throws for anyone else, which Next renders as the route's
// error boundary instead of the page.
export default async function TaskRulesPage() {
  await requireAdmin();
  const [rulesResult, staff] = await Promise.all([listTaskRules(), listStaffForMentions()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="כללי משימות אוטומטיות"
        description="כללים שרצים כל שבוע: רמזור אדום, שינויי מחיר קפואים ופערים ויזואליים הופכים למשימה בלי שאף אחד יזכור לפתוח את המסך."
      />
      <RulesClient
        initialRules={rulesResult.ok ? rulesResult.rules : []}
        initialError={rulesResult.ok ? null : rulesResult.error}
        staff={staff}
      />
    </div>
  );
}
