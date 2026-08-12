import { Home, Music, Ticket, type LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EntryFunnels } from "@/lib/partner-entry-funnels";
import type { FunnelStage, PartnerTraffic } from "@/lib/partner-funnel";

interface EntryFunnelRow {
  key: string;
  label: string;
  /** null = the flow has this step but nothing tracks it yet - rendered as "-". */
  visitors: number | null;
  /** Small print after the label - what this row really measures. */
  note?: string;
  /** Show the share un-rounded (Confirmed: 0.4% must not read as 0%). */
  precise?: boolean;
}

const stageVisitors = (funnel: PartnerTraffic, stage: FunnelStage) =>
  funnel.byStage.find((s) => s.stage === stage)?.visitors ?? 0;

/** What each recorded stage really marks - the click LEAVING that screen. */
const BROWSE_STAGE_NOTES: Partial<Record<FunnelStage, string>> = {
  EVENT_SELECTED: "clicked into an event",
  TICKET_SELECTED: "moved on to flights",
  FLIGHT_SELECTED: "moved on to the hotel",
  HOTEL_SELECTED: "reached the order summary",
  CONFIRMED: "paid or asked for an agent",
};

const PAID_ROW_NOTE = "order now marked Paid - matched by partner, event & time";

/** Home/artist entries: the recorded funnel, captioned like the event card,
 *  with the same matched-Paid row at the bottom. */
const browseEntryRows = (
  funnel: PartnerTraffic,
  paid: number
): EntryFunnelRow[] => [
  ...funnel.byStage.map((s) => ({
    key: s.stage,
    label: s.label,
    visitors: s.visitors,
    note: BROWSE_STAGE_NOTES[s.stage],
    precise: s.stage === "CONFIRMED",
  })),
  {
    key: "PAID",
    label: "Paid",
    note: PAID_ROW_NOTE,
    visitors: paid,
    precise: true,
  },
];

/**
 * Event deep-links land inside the order flow, so there is no "picked an
 * event" moment, and the wizard fires each stage on the click that LEAVES its
 * screen (see main's OrderForm nextStep): a ticket pick means moving on to
 * flights, a flight pick (chosen or skipped) moving on to the hotel, a hotel
 * pick reaching the order summary. Same counts, honest captions - plus one
 * caveat: /order pages fire VISIT only since main's Aug 5, 2026 tracker fix,
 * so older windows count a deep-link visitor only once they advanced a
 * screen. The grid's footnote spells this out.
 */
const eventEntryRows = (funnel: PartnerTraffic, paid: number): EntryFunnelRow[] => [
  {
    key: "VISIT",
    label: "Visited",
    note: "landed on the order page - see the note below on older windows",
    visitors: funnel.totalVisitors,
  },
  {
    key: "TICKET_SELECTED",
    label: "Picked tickets",
    note: "moved on to flights",
    visitors: stageVisitors(funnel, "TICKET_SELECTED"),
  },
  {
    key: "FLIGHT_SELECTED",
    label: "Picked a flight",
    note: "moved on to the hotel",
    visitors: stageVisitors(funnel, "FLIGHT_SELECTED"),
  },
  {
    key: "HOTEL_SELECTED",
    label: "Picked a hotel",
    note: "reached the order summary",
    visitors: stageVisitors(funnel, "HOTEL_SELECTED"),
  },
  {
    key: "CONFIRMED",
    label: "Confirmed",
    note: "paid or asked for an agent",
    visitors: stageVisitors(funnel, "CONFIRMED"),
    precise: true,
  },
  {
    key: "PAID",
    label: "Paid",
    note: PAID_ROW_NOTE,
    visitors: paid,
    precise: true,
  },
];

/** Exact enough to never show a real signal as 0%: 0.36%, 1.2%, 4.0%. */
const preciseShare = (pct: number) =>
  pct === 0 ? "0" : pct < 1 ? pct.toFixed(2) : pct.toFixed(1);

/** One entry-segment funnel: who landed there, how far they got. */
function EntryFunnelCard({
  icon: Icon,
  title,
  description,
  hasData,
  rows,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  hasData: boolean;
  rows: EntryFunnelRow[];
}) {
  const top = Math.max(...rows.map((r) => r.visitors ?? 0), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-6 text-sm text-muted-foreground">
            No visitors in this period.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const pct = row.visitors != null ? (row.visitors / top) * 100 : null;
              return (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      {row.label}
                      {row.note && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.note}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {row.visitors ?? "-"}
                      {pct != null && row.key !== "VISIT" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.precise ? preciseShare(pct) : Math.round(pct)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The three entry funnels + their footnote - shared by the cross-partner
 *  Insights tab and the per-partner performance view. */
export function EntryFunnelsGrid({ entryFunnels }: { entryFunnels: EntryFunnels }) {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <EntryFunnelCard
          icon={Home}
          title="Entered on the homepage"
          description="Visitors whose first page through a partner link was the homepage. Each step below marks moving one screen deeper."
          hasData={entryFunnels.home.hasData}
          rows={browseEntryRows(entryFunnels.home, entryFunnels.paidByEntry.home)}
        />
        <EntryFunnelCard
          icon={Music}
          title="Entered on an artist page"
          description="First landed on an artist or team page. Each step below marks moving one screen deeper."
          hasData={entryFunnels.artist.hasData}
          rows={browseEntryRows(entryFunnels.artist, entryFunnels.paidByEntry.artist)}
        />
        <EntryFunnelCard
          icon={Ticket}
          title="Entered on a specific event"
          description="Landed straight inside the order flow - package deep-links included. Each step below marks moving one screen deeper."
          hasData={entryFunnels.event.hasData}
          rows={eventEntryRows(entryFunnels.event, entryFunnels.paidByEntry.event)}
        />
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">
        {entryFunnels.otherVisitors > 0 &&
          `${entryFunnels.otherVisitors} more visitors entered on other pages (categories, blog…). `}
        {entryFunnels.approximate &&
          "Numbers are approximate until the entry-funnel DB function is deployed. "}
        Order-page landings are tracked since Aug 5, 2026 - before that a
        deep-link visitor is counted only once they advanced a screen, so
        &quot;Visited&quot; runs low on windows reaching further back.
      </p>
    </>
  );
}
