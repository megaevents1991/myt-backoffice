"use client";

import { CalendarDays, ClipboardList, Inbox, Map as MapIcon, Plane } from "lucide-react";

import { useActionData } from "@/hooks/use-action-data";
import { StatCard } from "@/components/dashboard/stat-card";
import { TopListCard } from "@/components/dashboard/top-list-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { MyTasksWidget } from "@/components/my-tasks-widget";
import { LoadError } from "@/components/tours/ui";
import { NeedsAttention } from "@/components/tours/dashboard/needs-attention";
import {
  getToursDashboard,
  getToursLeadsSeries,
  type Tally,
  type ToursDashboard as Data,
} from "@/lib/actions/tours-dashboard-actions";

const n = (value: number) => value.toLocaleString("en-US");
const pax = (tally: Tally | undefined) => `PAX: ${tally ? n(tally.travelers) : "..."}`;

/**
 * The dashboard of a tours company: the same sections as the Mega Events
 * dashboard (numbers, statistics, top lists, a trend, my tasks), filled with
 * tours, reservations and site leads.
 */
export function ToursDashboard({ isManager }: { isManager: boolean }) {
  const { data, error, loading, reload } = useActionData(() => getToursDashboard(), []);

  const v = (pick: (d: Data) => number) => (data ? n(pick(data)) : "...");
  // Without numbers the cards keep their placeholders - a failed load must not read as zeros or empty lists.
  const pending = data === null;

  return (
    <>
      {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Tours on Sale"
          value={v((d) => d.toursOnSale)}
          hint={data ? `${n(data.publishedDepartures)} published departures` : "Published, future dates"}
          icon={MapIcon}
          href="/tours/packages"
        />
        <StatCard
          label={`Departures (${data?.departuresWindowDays ?? 60} Days)`}
          value={v((d) => d.departuresInWindow)}
          hint={data ? `${n(data.publishedInWindow)} of them published` : "Leaving soon"}
          icon={CalendarDays}
          href="/tours/departures"
        />
        <StatCard
          label="Seats Left"
          value={v((d) => d.seatsLeft)}
          hint={data ? `Of ${n(data.seatsAllocated)} on live flights` : "On published departures"}
          icon={Plane}
          href="/offline-flights"
        />
        <StatCard
          label="Reservations"
          value={v((d) => d.reservationsTotal.count)}
          hint={data ? `${n(data.reservationsTotal.travelers)} travelers` : "All time"}
          icon={ClipboardList}
          href="/tours/reservations"
        />
        <StatCard
          label="New Leads"
          value={v((d) => d.newLeads)}
          hint="Waiting for a reply"
          icon={Inbox}
          href="/tours/leads"
        />
      </div>

      <h2 className="text-xl font-semibold tracking-tight mt-8">Statistics</h2>
      <div className="space-y-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Leads Last 30 Days"
            value={v((d) => d.leadsLast30)}
            hint={data ? `${n(data.leadsLast7)} in the last 7 days` : "..."}
          />
          <StatCard
            label="Reservations Last Month"
            value={v((d) => d.reservationsLastMonth.count)}
            hint={pax(data?.reservationsLastMonth)}
          />
          <StatCard
            label="Reservations This Month"
            value={v((d) => d.reservationsThisMonth.count)}
            hint={pax(data?.reservationsThisMonth)}
          />
          <StatCard
            label="Reservations Last 7 Days"
            value={v((d) => d.reservationsLast7.count)}
            hint={pax(data?.reservationsLast7)}
          />
          <StatCard
            label="Reservations Last 30 Days"
            value={v((d) => d.reservationsLast30.count)}
            hint={pax(data?.reservationsLast30)}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <TopListCard
            title="Top Tours (Reservations, 30d)"
            items={data?.topToursByReservations ?? []}
            loading={pending}
          />
          <TopListCard title="Top Tours (Leads, 30d)" items={data?.topToursByLeads ?? []} loading={pending} />
          <TopListCard title="Leads by Type (30d)" items={data?.leadsByType ?? []} loading={pending} />
        </div>
      </div>

      <TrendChart title="Leads Over Time" seriesLabel="Leads" load={getToursLeadsSeries} />

      <div className="grid gap-6 lg:grid-cols-2">
        <MyTasksWidget />
        {isManager && <NeedsAttention />}
      </div>

      {data?.truncated && (
        <p className="text-xs text-muted-foreground">
          Some numbers passed the read limit and show at least that many, not the exact total.
        </p>
      )}
    </>
  );
}
