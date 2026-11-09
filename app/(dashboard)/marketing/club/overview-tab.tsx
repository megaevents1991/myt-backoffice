"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClubPageData } from "./club-client";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const dayLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

function TrendNote({ trend }: { trend: ClubPageData["overview"]["members"]["trend"] }) {
  if (trend.dir === "none") return <span className="text-muted-foreground">no joins in either period</span>;
  if (trend.dir === "new") return <span className="text-muted-foreground">none in the previous period</span>;
  const sign = trend.change != null && trend.change > 0 ? "+" : "";
  return (
    <span className={trend.dir === "up" ? "text-emerald-600" : trend.dir === "down" ? "text-red-600" : "text-muted-foreground"}>
      {sign}
      {trend.change}% vs the previous period
    </span>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {note && <div className="mt-1 text-xs">{note}</div>}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ data }: { data: ClubPageData }) {
  const o = data.overview;
  const max = Math.max(1, ...o.joinsByDay.map((d) => d.count));
  const showEvery = o.joinsByDay.length > 31 ? Math.ceil(o.joinsByDay.length / 15) : o.joinsByDay.length > 14 ? 3 : 1;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Members (active)" value={o.members.total.toLocaleString("en-US")} />
        <Stat label="Joined in the period" value={o.members.inWindow.toLocaleString("en-US")} note={<TrendNote trend={o.members.trend} />} />
        <Stat label="Member orders" value={`${o.orders.paid} Paid`} note={<span className="text-muted-foreground">{o.orders.all} orders in all</span>} />
        <Stat label="Paid revenue from members" value={usd(o.paidRevenueUsd)} />
        <Stat
          label="Discount given (Paid)"
          value={usd(o.discountGivenUsd)}
          note={<span className="text-muted-foreground">${data.settings.discount_per_traveler_usd} per traveler now</span>}
        />
        <Stat label="Unsubscribed" value={o.unsubscribed.toLocaleString("en-US")} note={<span className="text-muted-foreground">keep the member price</span>} />
        <Stat
          label="Welcome mails failed"
          value={o.welcomeFailed.toLocaleString("en-US")}
          note={o.welcomeFailed ? <span className="text-red-600">resend from the Members tab</span> : undefined}
        />
        <Stat label="Club on the site" value={data.settings.enabled ? "On" : "Off"} note={<span className="text-muted-foreground">Settings tab</span>} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Joins per day</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-1" role="img" aria-label="Joins per day">
            {o.joinsByDay.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end" title={`${dayLabel(d.day)}: ${d.count}`}>
                {d.count > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{d.count}</span>}
                <div className="w-full rounded-t bg-primary" style={{ height: `${(d.count / max) * 85}%`, minHeight: d.count ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            {o.joinsByDay.map((d, i) => (
              <span key={d.day} className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground">
                {i % showEvery === 0 ? dayLabel(d.day) : ""}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where people joined</CardTitle>
        </CardHeader>
        <CardContent>
          {o.topEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody joined in this period.</p>
          ) : (
            <ul className="divide-y text-sm">
              {o.topEvents.map((t) => (
                <li key={t.eventId} className="flex justify-between py-2">
                  <span>{data.topEventNames[t.eventId] ?? `Event #${t.eventId}`}</span>
                  <span className="tabular-nums">{t.members}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
