import Link from "next/link";
import { Bot, ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/guards";
import { listAgentsOverview } from "@/lib/services/ai-factory";
import { maturityRateText, SWITCH_BADGE, SWITCH_LABEL, formatUsd } from "./ai-factory-ui";

// AI Factory - one card per registered agent: what it is, whether it is switched on, this
// month's AI spend, and how well its calls have held up against what staff actually decided.
// Admin-only, guarded the same way /price-light is (requireAdmin() here too, not just the hidden
// nav item, so a direct /ai-factory hit from a non-admin never renders the screen).
export default async function AiFactoryPage() {
  await requireAdmin();
  const agents = await listAgentsOverview();

  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title="AI Factory"
        description="הזהות, הזיכרון, יומן ההחלטות והבשלות של כל agent שרץ במערכת."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Link key={agent.key} href={`/ai-factory/${agent.key}`} className="block">
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">{agent.title}</CardTitle>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${SWITCH_BADGE[agent.switchState]}`}>
                  {SWITCH_LABEL[agent.switchState]}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">{agent.model}</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] text-muted-foreground">עלות החודש</div>
                    <div className="tabular-nums font-medium">{formatUsd(agent.costUsdThisMonth)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">קריאות החודש</div>
                    <div className="tabular-nums font-medium">{agent.callsThisMonth}</div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">שיעור התאמה</div>
                  <div className="tabular-nums font-medium">{maturityRateText(agent.maturityRate)}</div>
                </div>
                <div className="flex items-center gap-1 pt-1 text-xs font-medium text-primary">
                  לפרטים <ChevronLeft className="h-3.5 w-3.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        <Card className="flex h-full min-h-[180px] items-center justify-center border-dashed">
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            עוד agents בדרך
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
