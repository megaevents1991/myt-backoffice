"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Home, Music, Ticket, type LucideIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { getTraffic } from "@/lib/actions/marketing-traffic-actions";
import { SOURCE_LABEL } from "@/lib/marketing/order-source";
import { STEP_HINT, STEP_LABEL, type EntryFunnelKind, type TrafficStep } from "@/lib/marketing/traffic";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMarketingLoad } from "./marketing-shared";

type Loaded = Extract<Awaited<ReturnType<typeof getTraffic>>, { connected: true }>;

const num = (n: number) => n.toLocaleString("en-US");
const pctText = (p: number | null) => (p === null ? "—" : p < 1 && p > 0 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`);
const rate = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

const bucketConfig = {
  meta: { label: SOURCE_LABEL.meta, color: "hsl(var(--chart-1))" },
  google: { label: SOURCE_LABEL.google, color: "hsl(var(--chart-2))" },
  partners: { label: SOURCE_LABEL.partners, color: "hsl(var(--chart-4))" },
  no_utm: { label: SOURCE_LABEL.no_utm, color: "hsl(var(--chart-3))" },
  other: { label: SOURCE_LABEL.other, color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

function Stat({ title, value, hint, tag }: { title: string; value: string; hint?: string; tag: "GA4" | "ours" }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal normal-case tracking-normal">
            {tag}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div dir="ltr" className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const FUNNEL_CARD: Record<EntryFunnelKind, { icon: LucideIcon; title: string; description: string }> = {
  home: { icon: Home, title: "Entered on the homepage", description: "Sessions whose first page was the homepage. Each step = sessions in which that step happened." },
  artist: { icon: Music, title: "Entered on an artist page", description: "First page was an artist or team page (the Partners screen's rule)." },
  event: { icon: Ticket, title: "Entered on a specific event", description: "Landed straight inside the order flow - no 'picked an event' step." },
};

function FunnelCard({ kind, steps }: { kind: EntryFunnelKind; steps: TrafficStep[] }) {
  const { icon: Icon, title, description } = FUNNEL_CARD[kind];
  const visited = steps[0]?.sessions ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {visited === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No sessions in this period.</p>
        ) : (
          <div className="space-y-3">
            {steps.map((s) => (
              <div key={s.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    {STEP_LABEL[s.key]}
                    <span className="ms-2 text-xs text-muted-foreground">{STEP_HINT[s.key]}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {num(s.sessions)}
                    {s.pct !== null && <span className="ms-2 text-xs text-muted-foreground">{pctText(s.pct)}</span>}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${visited > 0 ? (s.sessions / visited) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SourcesTable({ sources }: { sources: Loaded["sources"] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-end">Sessions</TableHead>
            <TableHead className="text-end">Users</TableHead>
            <TableHead className="text-end">Engagement</TableHead>
            <TableHead className="text-end">Confirmed</TableHead>
            <TableHead className="text-end">Purchased</TableHead>
            <TableHead className="text-end">Leads (ours)</TableHead>
            <TableHead className="text-end">Signups (ours)</TableHead>
            <TableHead className="text-end">Conversion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((s) => {
            const expanded = open === s.bucket;
            return (
              <Fragment key={s.bucket}>
                <TableRow className="cursor-pointer" onClick={() => setOpen(expanded ? null : s.bucket)}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                      {SOURCE_LABEL[s.bucket]}
                    </span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{num(s.sessions)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(s.users)}</TableCell>
                  <TableCell className="text-end tabular-nums">{pctText(rate(s.engaged, s.sessions))}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(s.confirmed)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(s.purchased)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(s.leads)}</TableCell>
                  <TableCell className="text-end font-medium tabular-nums">{num(s.signups)}</TableCell>
                  <TableCell className="text-end tabular-nums">{pctText(rate(s.signups, s.sessions))}</TableCell>
                </TableRow>
                {expanded &&
                  s.rows.map((r) => (
                    <TableRow key={`${s.bucket}:${r.sourceMedium}`} className="bg-muted/30 text-xs hover:bg-muted/30">
                      <TableCell dir="ltr" className="ps-8 text-muted-foreground">{r.sourceMedium}</TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.sessions)}</TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.users)}</TableCell>
                      <TableCell className="text-end tabular-nums">{pctText(rate(r.engaged, r.sessions))}</TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.confirmed)}</TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.purchased)}</TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { home: "Home", artist: "Artist / team", event: "Event", other: "Other" };

export function TrafficTab() {
  const { data, error, loading } = useMarketingLoad(getTraffic);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  if (!data.connected) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          GA4 is not connected. Set <code>NEXT_SECRET_GA4_PROPERTY_ID</code> and <code>NEXT_SECRET_GA4_SA_JSON_B64</code> (a service account with Viewer on the property).
        </CardContent>
      </Card>
    );
  }
  return (
    <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat title="Sessions" value={num(data.sessions)} tag="GA4" />
        <Stat title="Users" value={num(data.users)} tag="GA4" hint="Summed per source" />
        <Stat title="Engagement" value={pctText(data.engagementRate)} tag="GA4" hint="Engaged sessions" />
        <Stat title="Leads" value={num(data.leads)} tag="ours" hint="Orders entered" />
        <Stat title="Signups" value={num(data.signups)} tag="ours" hint="Paid orders" />
        <Stat title="Conversion" value={pctText(data.conversion)} tag="ours" hint="Signups / sessions" />
      </div>

      <SectionCard title="Sessions per day" description="By source - Meta, Google Ads, partners, no UTM, everything else.">
        <ChartContainer config={bucketConfig} className="aspect-auto h-[260px] w-full">
          <BarChart data={data.daily} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
            <YAxis allowDecimals={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {(Object.keys(bucketConfig) as (keyof typeof bucketConfig)[]).map((b) => (
              <Bar key={b} dataKey={b} stackId="s" fill={`var(--color-${b})`} />
            ))}
          </BarChart>
        </ChartContainer>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <FunnelCard kind="home" steps={data.funnels.home} />
        <FunnelCard kind="artist" steps={data.funnels.artist} />
        <FunnelCard kind="event" steps={data.funnels.event} />
      </div>
      <p className="text-xs text-muted-foreground">
        {num(data.otherEntries)} more sessions entered on other pages (categories, blog...). Steps are GA4 events: select_item, add_to_cart (flight
        search), view_cart (order summary), begin_checkout + generate_lead (confirmed), purchase.
      </p>

      <SectionCard title="Sources" description="Click a source for its source / medium rows. Leads and signups are our orders by the same source rule as the Executive funnel.">
        <SourcesTable sources={data.sources} />
      </SectionCard>

      <SectionCard title="Top landing pages">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-end">Sessions</TableHead>
                <TableHead className="text-end">Purchased</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.landing.map((l) => (
                <TableRow key={l.page}>
                  <TableCell dir="ltr" className="max-w-[28rem] truncate font-mono text-xs" title={l.page}>
                    {l.page}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{num(l.sessions)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(l.purchased)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}
