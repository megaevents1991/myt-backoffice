"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { getTimeToPurchase, type Ga4LagPart } from "@/lib/actions/marketing-time-lag-actions";
import { SOURCE_LABEL } from "@/lib/marketing/order-source";
import { formatLagDays, formatLagHours, type LagBucket, type LagStats, type TimeLagView } from "@/lib/marketing/time-to-purchase";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMarketingLoad } from "./marketing-shared";

const num = (n: number) => n.toLocaleString("en-US");
const pctText = (p: number | null) => (p === null ? "—" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`);
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
/** The share between "within 24 h" and "over 7 days" - the two the table prints beside it. */
const middlePct = (s: LagStats) => (s.within24hPct === null || s.over7dPct === null ? null : Math.max(0, 100 - s.within24hPct - s.over7dPct));

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

/** One row per bucket: label, count, share, and a bar of that share. */
function BucketBars({ buckets }: { buckets: LagBucket[] }) {
  return (
    <div className="space-y-3">
      {buckets.map((b) => (
        <div key={b.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>{b.label}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {num(b.count)}
              <span className="ms-2 text-xs text-muted-foreground">{pctText(b.pct)}</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${b.pct ?? 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Ga4Half({ ga4 }: { ga4: Ga4LagPart }) {
  if (!ga4.connected) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        GA4 is not connected. Set <code>NEXT_SECRET_GA4_PROPERTY_ID</code> and <code>NEXT_SECRET_GA4_SA_JSON_B64</code>.
      </p>
    );
  }
  if (ga4.error !== undefined) return <p className="py-6 text-sm text-destructive">Google Analytics answered: {ga4.error}</p>;
  if (ga4.purchases === 0) return <p className="py-6 text-sm text-muted-foreground">No purchase events in this period.</p>;
  return (
    <div className="space-y-3">
      <BucketBars buckets={ga4.buckets} />
      <p className="text-xs text-muted-foreground">
        {num(ga4.purchases)} purchase events · median {formatLagDays(ga4.medianDays)} · mean {formatLagDays(ga4.meanDays)}
        {ga4.unmeasured > 0 && ` · ${num(ga4.unmeasured)} without a first-session date`}
      </p>
    </div>
  );
}

function SourceTable({ ours }: { ours: TimeLagView }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-end">Paid orders</TableHead>
            <TableHead className="text-end">Measured</TableHead>
            <TableHead className="text-end">Median</TableHead>
            <TableHead className="text-end">Mean</TableHead>
            <TableHead className="text-end">Within 24 h</TableHead>
            <TableHead className="text-end">1-7 days</TableHead>
            <TableHead className="text-end">Over 7 days</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ours.bySource.map((r) => (
            <TableRow key={r.source}>
              <TableCell className="font-medium">{SOURCE_LABEL[r.source]}</TableCell>
              <TableCell className="text-end tabular-nums">{num(r.orders)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {num(r.measured)}
                <span className="ms-2 text-xs text-muted-foreground">{pctText(share(r.measured, r.orders))}</span>
              </TableCell>
              <TableCell dir="ltr" className="text-end font-medium tabular-nums">{formatLagHours(r.stats.medianHours)}</TableCell>
              <TableCell dir="ltr" className="text-end tabular-nums">{formatLagHours(r.stats.meanHours)}</TableCell>
              <TableCell className="text-end tabular-nums">{pctText(r.stats.within24hPct)}</TableCell>
              <TableCell className="text-end tabular-nums">{pctText(middlePct(r.stats))}</TableCell>
              <TableCell className="text-end tabular-nums">{pctText(r.stats.over7dPct)}</TableCell>
            </TableRow>
          ))}
          {ours.bySource.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No Paid orders in this period.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function TimeLagTab() {
  const { data, view, error, loading } = useMarketingLoad(getTimeToPurchase);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  const { ours, ga4 } = data;
  const ga4Ok = ga4.connected && ga4.error === undefined ? ga4 : null;
  const srcLabel = view.src === "all" ? "All sources" : SOURCE_LABEL[view.src];
  return (
    <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat title="Paid orders" value={num(ours.orders)} tag="ours" hint={srcLabel} />
        <Stat title="Measured" value={ours.orders ? `${num(ours.measured)} · ${pctText(share(ours.measured, ours.orders))}` : "—"} tag="ours" hint="Orders with a dated tracked visit" />
        <Stat title="Median" value={formatLagHours(ours.all.medianHours)} tag="ours" hint="First tracked visit → order" />
        <Stat title="Within 24 h" value={pctText(ours.all.within24hPct)} tag="ours" hint="Of the measured orders" />
        <Stat title="Median" value={ga4Ok ? formatLagDays(ga4Ok.medianDays) : "—"} tag="GA4" hint="First session → purchase, every buyer" />
        <Stat title="Same day" value={ga4Ok ? pctText(ga4Ok.sameDayPct) : "—"} tag="GA4" hint="Of GA4's purchase events" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Ours: first tracked visit → order" description="In hours. Every Paid order of the period whose first tracked visit is dated, under the source filter.">
          {ours.measured === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No measured orders in this period.</p>
          ) : (
            <div className="space-y-3">
              <BucketBars buckets={ours.all.buckets} />
              <p className="text-xs text-muted-foreground">
                {num(ours.measured)} measured · median {formatLagHours(ours.all.medianHours)} · mean {formatLagHours(ours.all.meanHours)}
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {num(ours.unmeasured)} {ours.unmeasured === 1 ? "order" : "orders"} not measured - no tracked visit (direct, organic search, a booking typed by an agent).
          </p>
        </SectionCard>
        <SectionCard title="GA4: first session → purchase" description="In days. Every purchase event of the period, whatever brought the buyer, by GA4's own user. The source filter does not apply here.">
          <Ga4Half ga4={ga4} />
        </SectionCard>
      </div>

      <SectionCard title="By source" description="Our orders by the Executive funnel's source rule. A 'No UTM' order carries no tracked visit, so it is never measured.">
        <SourceTable ours={ours} />
      </SectionCard>

      <SectionCard title="How this is measured">
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">Period:</span> Israel calendar days. An order belongs to the day it was created; a GA4 purchase to the day the event fired.
          </li>
          <li>
            <span className="text-foreground">Ours:</span> Paid orders only. The first tracked visit is the earliest visit the site stamped on the order - a visit that came with a UTM, a gclid or an fbclid; the cookie keeps the newest five for 90 days, so a buyer who first came four months ago reads from their newest 90 days.
          </li>
          <li>
            <span className="text-foreground">Not measured:</span> no tracked visit at all - direct, organic search, a partner or agent booking typed for the customer, and orders older than the visit timestamps. Counted, never guessed.
          </li>
          <li>
            <span className="text-foreground">GA4:</span> purchase events; days = the purchase day minus the user&apos;s first-session day. A user is GA4&apos;s cookie - a new device or cleared cookies is a new user - and every source counts. &quot;(not set)&quot; first-session dates are not measured.
          </li>
          <li>
            <span className="text-foreground">The two halves never add up to one number:</span> ours counts orders in hours for tracked visits, GA4 counts purchase events in days for everyone. Compare each with itself over time.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
