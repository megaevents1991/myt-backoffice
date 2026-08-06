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

/**
 * The three entry-segmented funnels, in Hebrew — the portal-facing port of the
 * staff insights grid (app/(dashboard)/partners/entry-funnel-cards.tsx). Same
 * data shape, same semantics; only the copy differs. Keep the row logic in
 * step with the staff component.
 */

interface EntryFunnelRow {
  key: string;
  label: string;
  visitors: number | null;
  /** Small print after the label — what this row really measures. */
  note?: string;
  /** Show the share un-rounded (a 0.4% Paid row must not read as 0%). */
  precise?: boolean;
}

const stageVisitors = (funnel: PartnerTraffic, stage: FunnelStage) =>
  funnel.byStage.find((s) => s.stage === stage)?.visitors ?? 0;

/** What each recorded stage really marks — the click LEAVING that screen. */
const BROWSE_STAGE_NOTES: Partial<Record<FunnelStage, string>> = {
  EVENT_SELECTED: "לחצו על אירוע",
  TICKET_SELECTED: "המשיכו לטיסות",
  FLIGHT_SELECTED: "המשיכו למלון",
  HOTEL_SELECTED: "הגיעו לסיכום ההזמנה",
  CONFIRMED: "שילמו או ביקשו נציג",
};

const BROWSE_STAGE_LABELS: Record<FunnelStage, string> = {
  VISIT: "נכנסו",
  EVENT_SELECTED: "בחרו אירוע",
  TICKET_SELECTED: "בחרו כרטיסים",
  FLIGHT_SELECTED: "בחרו טיסה",
  HOTEL_SELECTED: "בחרו מלון",
  CONFIRMED: "הגיעו לתשלום",
};

const PAID_ROW_NOTE = "הזמנה ששולמה — משויכת לפי שותף, אירוע וזמן";

const browseEntryRows = (
  funnel: PartnerTraffic,
  paid: number
): EntryFunnelRow[] => [
  ...funnel.byStage.map((s) => ({
    key: s.stage,
    label: BROWSE_STAGE_LABELS[s.stage],
    visitors: s.visitors,
    note: BROWSE_STAGE_NOTES[s.stage],
    precise: s.stage === "CONFIRMED",
  })),
  { key: "PAID", label: "שילמו", note: PAID_ROW_NOTE, visitors: paid, precise: true },
];

/** Event deep-links land inside the order flow — no "picked an event" moment;
 *  each stage marks the click that LEAVES its screen. */
const eventEntryRows = (funnel: PartnerTraffic, paid: number): EntryFunnelRow[] => [
  {
    key: "VISIT",
    label: "נכנסו",
    note: "נחתו ישירות בעמוד ההזמנה",
    visitors: funnel.totalVisitors,
  },
  {
    key: "TICKET_SELECTED",
    label: "בחרו כרטיסים",
    note: "המשיכו לטיסות",
    visitors: stageVisitors(funnel, "TICKET_SELECTED"),
  },
  {
    key: "FLIGHT_SELECTED",
    label: "בחרו טיסה",
    note: "המשיכו למלון",
    visitors: stageVisitors(funnel, "FLIGHT_SELECTED"),
  },
  {
    key: "HOTEL_SELECTED",
    label: "בחרו מלון",
    note: "הגיעו לסיכום ההזמנה",
    visitors: stageVisitors(funnel, "HOTEL_SELECTED"),
  },
  {
    key: "CONFIRMED",
    label: "הגיעו לתשלום",
    note: "שילמו או ביקשו נציג",
    visitors: stageVisitors(funnel, "CONFIRMED"),
    precise: true,
  },
  { key: "PAID", label: "שילמו", note: PAID_ROW_NOTE, visitors: paid, precise: true },
];

/** Exact enough to never show a real signal as 0%: 0.36%, 1.2%, 4.0%. */
const preciseShare = (pct: number) =>
  pct === 0 ? "0" : pct < 1 ? pct.toFixed(2) : pct.toFixed(1);

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
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-6 text-sm text-muted-foreground">
            אין מבקרים בתקופה הזו.
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
                        <span className="ms-2 text-xs text-muted-foreground">
                          {row.note}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3 font-medium tabular-nums">
                      <span>{row.visitors ?? "—"}</span>
                      {pct != null && row.key !== "VISIT" && (
                        <span className="text-xs text-muted-foreground">
                          {row.precise ? preciseShare(pct) : Math.round(pct)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand-mint"
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

export function PortalEntryFunnels({ entryFunnels }: { entryFunnels: EntryFunnels }) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <EntryFunnelCard
          icon={Home}
          title="נכנסו דרך דף הבית"
          description="מבקרים שהעמוד הראשון שלהם דרך הלינק שלכם היה דף הבית."
          hasData={entryFunnels.home.hasData}
          rows={browseEntryRows(entryFunnels.home, entryFunnels.paidByEntry.home)}
        />
        <EntryFunnelCard
          icon={Music}
          title="נכנסו דרך דף אמן"
          description="נחתו קודם בעמוד אמן או קבוצה. כל שלב מסמן התקדמות מסך אחד פנימה."
          hasData={entryFunnels.artist.hasData}
          rows={browseEntryRows(entryFunnels.artist, entryFunnels.paidByEntry.artist)}
        />
        <EntryFunnelCard
          icon={Ticket}
          title="נכנסו ישירות לאירוע"
          description="נחתו ישר בתוך תהליך ההזמנה — כולל לינקים לחבילות מוכנות."
          hasData={entryFunnels.event.hasData}
          rows={eventEntryRows(entryFunnels.event, entryFunnels.paidByEntry.event)}
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {entryFunnels.otherVisitors > 0 &&
          `${entryFunnels.otherVisitors} מבקרים נוספים נכנסו דרך עמודים אחרים (קטגוריות, בלוג…). `}
        כניסות לעמוד ההזמנה נמדדות מ-5 באוגוסט 2026 — בטווחים ישנים יותר מבקר
        בלינק ישיר נספר רק אחרי שהתקדם מסך.
      </p>
    </>
  );
}
