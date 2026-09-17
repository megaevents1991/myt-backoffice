import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/guards";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents";
import { AGENT_LOG_PAGE_SIZE, getAgentDetail, listAgentLog, loadMaturity } from "@/lib/services/ai-factory";
import { formatUsd, maturityRateText, SWITCH_BADGE, SWITCH_LABEL } from "../ai-factory-ui";
import { AgentTabs } from "./agent-tabs";
import { TeachForm } from "./teach-form";
import { TaughtRulesList } from "./taught-rules-list";
import { FeedbackButtons } from "./feedback-buttons";
import { MaturityChart } from "./maturity-chart";

function isAgentKey(v: string): v is AgentKey {
  return (AGENT_KEYS as readonly string[]).includes(v);
}

const SETTINGS_LABEL: Record<string, string> = {
  model: "מודל",
  callsPerRun: "תקרת קריאות לריצה",
  confidenceMin: "רף ביטחון מינימלי",
  timeoutMs: "טיימאאוט (מ״ש)",
  usdPerMInput: "$ למיליון טוקן קלט",
  usdPerMOutput: "$ למיליון טוקן פלט",
  memoryMaxChars: "תקרת זיכרון (תווים)",
  lessonMax: "מספר לקחים מוצג",
  lessonLookbackDays: "טווח לקחים (ימים)",
};

/** Third-person Hebrew, matching the same-event / unknown vocabulary the judge itself answers in. */
function sameEventText(v: boolean | "unknown" | null): string {
  if (v === true) return "כן";
  if (v === false) return "לא";
  return "לא ידוע";
}

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ tab?: string; logPage?: string }>;
}) {
  await requireAdmin();
  const { key: rawKey } = await params;
  if (!isAgentKey(rawKey)) notFound();
  const key = rawKey;
  const { tab, logPage: logPageRaw } = await searchParams;
  const logPage = Math.max(0, Number.parseInt(logPageRaw ?? "0", 10) || 0);

  const [detail, log, maturity] = await Promise.all([
    getAgentDetail(key),
    listAgentLog(key, logPage),
    loadMaturity(key),
  ]);

  const logHref = (page: number) => `/ai-factory/${key}?tab=log&logPage=${page}`;

  const identityTab = (
    <div className="space-y-6">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.role}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">מחליט לבד</h3>
          <ul className="space-y-1 text-sm">
            {detail.decides.map((d, i) => <li key={i}>• {d}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">אף פעם לא</h3>
          <ul className="space-y-1 text-sm">
            {detail.neverDoes.map((d, i) => <li key={i}>• {d}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">נשאר אצל הצוות</h3>
          <ul className="space-y-1 text-sm">
            {detail.humanDecides.map((d, i) => <li key={i}>• {d}</li>)}
          </ul>
        </div>
      </div>
      <Separator />
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">הגדרות</h3>
        <Table>
          <TableBody>
            {Object.entries(SETTINGS_LABEL).map(([field, label]) => (
              <TableRow key={field}>
                <TableCell className="text-muted-foreground">{label}</TableCell>
                <TableCell className="tabular-nums font-medium">
                  {String(detail.settings[field as keyof typeof detail.settings])}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">איך מדליקים</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li><code className="rounded bg-muted px-1 py-0.5">{detail.settings.switchEnv}=on</code> - מפעיל את הסוכן הזה</li>
          {detail.settings.modelEnv && (
            <li><code className="rounded bg-muted px-1 py-0.5">{detail.settings.modelEnv}</code> - דורס את המודל</li>
          )}
          <li><code className="rounded bg-muted px-1 py-0.5">{detail.settings.keyEnv}</code> - מפתח Anthropic (חייב להתחיל ב-sk-ant-)</li>
          <li><code className="rounded bg-muted px-1 py-0.5">{detail.settings.masterSwitchEnv}=off</code> - מפסק ראשי שמכבה את כל ה-agents</li>
        </ul>
      </div>
    </div>
  );

  const memoryTab = (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">כללי הבית (נוצר מהקבועים בקוד)</h3>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">{detail.houseRules}</pre>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">לקחים (כמו שהפרומפט רואה אותם)</h3>
        {detail.lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין עדיין החלטות מתועדות ללמוד מהן.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {detail.lessons.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
        )}
      </div>
      <Separator />
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">כללי צוות</h3>
        <div className="mb-3">
          <TaughtRulesList rules={detail.taughtRules} />
        </div>
        <TeachForm agentKey={key} />
      </div>
    </div>
  );

  const logTab = (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>אירוע</TableHead>
            <TableHead>מתחרה</TableHead>
            <TableHead>סוג</TableHead>
            <TableHead>אותו אירוע?</TableHead>
            <TableHead>ביטחון</TableHead>
            <TableHead>עלות</TableHead>
            <TableHead>קאש</TableHead>
            <TableHead>נוצר</TableHead>
            <TableHead>משוב</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {log.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                אין עדיין קריאות AI מתועדות.
              </TableCell>
            </TableRow>
          )}
          {log.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link href={`/events/${row.eventId}`} className="text-primary hover:underline">
                  {row.eventName ?? `#${row.eventId}`}
                </Link>
              </TableCell>
              <TableCell>{row.competitor}</TableCell>
              <TableCell>{row.scope}</TableCell>
              <TableCell>{sameEventText(row.verdict.sameEvent)}</TableCell>
              <TableCell className="tabular-nums">
                {row.verdict.confidence != null ? row.verdict.confidence.toFixed(2) : "-"}
              </TableCell>
              <TableCell className="tabular-nums">
                {row.verdict.costUsd != null ? formatUsd(row.verdict.costUsd) : "-"}
              </TableCell>
              <TableCell>{row.verdict.cached ? "כן" : "לא"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString("he-IL")}
              </TableCell>
              <TableCell>
                <FeedbackButtons agentKey={key} row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between">
        {logPage === 0 ? (
          <Button variant="outline" size="sm" disabled>הקודם</Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={logHref(logPage - 1)}>הקודם</Link>
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          עמוד {logPage + 1} · {AGENT_LOG_PAGE_SIZE} בעמוד
        </span>
        {!log.hasMore ? (
          <Button variant="outline" size="sm" disabled>הבא</Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={logHref(logPage + 1)}>הבא</Link>
          </Button>
        )}
      </div>
    </div>
  );

  const maturityTab = (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-muted-foreground">הסכמה</div>
          <div className="text-2xl font-semibold tabular-nums">{maturity.agreed}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">חוסר הסכמה</div>
          <div className="text-2xl font-semibold tabular-nums">{maturity.disagreed}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">משוב חיובי</div>
          <div className="text-2xl font-semibold tabular-nums">{maturity.reviewedOk}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">משוב שלילי</div>
          <div className="text-2xl font-semibold tabular-nums">{maturity.reviewedBad}</div>
        </div>
      </div>
      <div>
        <div className="text-[11px] text-muted-foreground">שיעור התאמה (30 יום)</div>
        <div className="text-2xl font-semibold tabular-nums">{maturityRateText(maturity.rate)}</div>
      </div>
      <MaturityChart weekly={maturity.weekly} />
      <p className="text-xs text-muted-foreground">
        הורדה אוטומטית של אדום מהפיד: לא פעיל. יופעל רק אחרי שתקבעו סף בשלות.
      </p>
    </div>
  );

  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title={detail.title}
        description={detail.role}
        actions={
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${SWITCH_BADGE[detail.switchState]}`}>
            {SWITCH_LABEL[detail.switchState]}
          </span>
        }
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentTabs
            defaultTab={tab === "memory" || tab === "log" || tab === "maturity" ? tab : "identity"}
            identity={identityTab}
            memory={memoryTab}
            log={logTab}
            maturity={maturityTab}
          />
        </CardContent>
      </Card>
    </div>
  );
}
