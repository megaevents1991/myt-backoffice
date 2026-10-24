"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { setRouteRequestsStatus } from "@/lib/actions/itinerary-routes-actions";
import { groupDraftTitle, type RouteRequest, type RouteRequestGroupView } from "@/lib/itinerary/requests";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TripDialog, tripDate, type TripDraft } from "../trip-dialog";

const STATUS_TEXT: Record<RouteRequestGroupView["status"], string> = {
  new: "ממתינה",
  published: "הועלתה כטריפ",
  rejected: "נדחתה",
};

/** "24/10/26 11:40", Israel time. */
const whenText = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

type Dialog = { open: boolean; draft: TripDraft | null; requestIds: number[] };

/** One customer's request inside a group: who, when, the name they gave, the hold they made. */
function RequestLine({ r }: { r: RouteRequest }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t py-2 text-sm first:border-t-0">
      <span className="text-muted-foreground">
        <bdi>{whenText(r.createdAt)}</bdi>
      </span>
      <span className="font-medium">
        <bdi>{r.contactName || "ללא שם"}</bdi>
      </span>
      {r.contactPhone && (
        <span dir="ltr" className="tabular-nums">
          {r.contactPhone}
        </span>
      )}
      {r.contactEmail && (
        <span dir="ltr" className="break-all text-muted-foreground">
          {r.contactEmail}
        </span>
      )}
      {r.pax !== null && <span className="text-muted-foreground">{r.pax} נוסעים</span>}
      {r.title && (
        <span>
          השם שנתן: <bdi className="font-medium">{r.title}</bdi>
        </span>
      )}
      {r.reservationId !== null && (
        <Link href={`/reservations/${r.reservationId}`} className="text-primary underline underline-offset-2">
          להזמנה #{r.reservationId}
        </Link>
      )}
      {r.status !== "new" && <span className="text-xs text-muted-foreground">({STATUS_TEXT[r.status]})</span>}
    </li>
  );
}

/**
 * Customers' offered trips, one card per set of events (lib/itinerary/requests.ts): the waiting ones first,
 * most requests first. "הפוך לטריפ" opens the trip dialog with their name and events and marks the waiting
 * requests published on save; "דחייה" rejects them (undo: "החזרה לבקשות").
 */
export function RequestsClient({ groups, nextSortOrder }: { groups: RouteRequestGroupView[]; nextSortOrder: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<Dialog>({ open: false, draft: null, requestIds: [] });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const locked = busyKey !== null || refreshing;

  const refresh = () => startRefresh(() => router.refresh());

  async function setStatus(group: RouteRequestGroupView, status: "rejected" | "new") {
    const ids =
      status === "rejected" ? group.newIds : group.requests.filter((r) => r.status === "rejected").map((r) => r.id);
    if (ids.length === 0) return;
    setBusyKey(group.key);
    try {
      const res = await setRouteRequestsStatus(ids, status);
      if ("error" in res) {
        toast({ variant: "destructive", title: "השמירה נכשלה", description: res.error });
        return;
      }
      toast({ title: status === "rejected" ? "הבקשה נדחתה" : "הבקשה הוחזרה לממתינות" });
      refresh();
    } catch (e) {
      console.error("setRouteRequestsStatus failed", e);
      toast({ variant: "destructive", title: "השמירה נכשלה", description: e instanceof Error ? e.message : "שגיאה לא צפויה" });
    } finally {
      setBusyKey(null);
    }
  }

  const waiting = groups.filter((g) => g.status === "new");
  const handled = groups.filter((g) => g.status !== "new");

  const card = (group: RouteRequestGroupView) => {
    const found = new Set(group.events.map((e) => e.id));
    const missingIds = group.eventIds.filter((id) => !found.has(id));
    const title = groupDraftTitle(group);
    const busy = busyKey === group.key;
    return (
      <li key={group.key} className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className={cn("text-base font-semibold", !title && "text-muted-foreground")}>
                <bdi>{title || "ללא שם"}</bdi>
              </h2>
              {group.requests.length > 1 && (
                <Badge variant="secondary" className="gap-1">
                  <Users className="h-3 w-3" aria-hidden />
                  {group.requests.length} הציעו
                </Badge>
              )}
              <Badge variant={group.status === "new" ? "default" : "outline"}>{STATUS_TEXT[group.status]}</Badge>
            </div>

            {group.titles.length > 1 && (
              <p className="text-xs text-muted-foreground">
                שמות נוספים: <bdi>{group.titles.slice(1).join(" · ")}</bdi>
              </p>
            )}

            <ol className="space-y-0.5 text-sm">
              {group.events.map((e) => (
                <li key={e.id}>
                  <bdi>{[e.name, tripDate(e.date), e.place].filter(Boolean).join(" · ")}</bdi>
                </li>
              ))}
              {missingIds.map((id) => (
                <li key={id} className="text-amber-700 dark:text-amber-400">
                  <bdi>#{id} · האירוע לא נמצא</bdi>
                </li>
              ))}
            </ol>

            <p className={cn("text-sm", group.site.shown ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
              {group.site.text}
            </p>

            {group.status === "new" && group.existingRouteId !== null && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                כבר יש טריפ עם האירועים האלה -{" "}
                <Link href="/events/trips" className="underline underline-offset-2">
                  ללשונית הטריפים
                </Link>
              </p>
            )}
            {group.status === "published" && (
              <p className="text-sm text-muted-foreground">
                <Link href="/events/trips" className="underline underline-offset-2">
                  לטריפ בלשונית הטריפים
                </Link>
              </p>
            )}

            <details className="rounded-md bg-muted/40 px-3 py-1">
              <summary className="cursor-pointer py-1 text-sm font-medium">פרטי הלקוחות ({group.requests.length})</summary>
              <ul className="pb-1">
                {group.requests.map((r) => (
                  <RequestLine key={r.id} r={r} />
                ))}
              </ul>
            </details>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {group.status === "new" ? (
              <>
                <Button
                  size="sm"
                  disabled={locked}
                  onClick={() =>
                    setDialog({
                      open: true,
                      draft: { key: group.key, title, eventIds: group.eventIds, events: group.events },
                      requestIds: group.newIds,
                    })
                  }
                >
                  הפוך לטריפ
                </Button>
                <Button size="sm" variant="outline" disabled={locked} onClick={() => setStatus(group, "rejected")}>
                  {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                  דחייה
                </Button>
              </>
            ) : group.status === "rejected" ? (
              <Button size="sm" variant="outline" disabled={locked} onClick={() => setStatus(group, "new")}>
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                החזרה לבקשות
              </Button>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          עוד אין בקשות. כשלקוח שבנה טיול בעצמו מסמן בסיכום &quot;רוצים שנציע את הטיול שלכם גם לאחרים?&quot; ושומר את
          הטיול, הבקשה מופיעה כאן.
        </div>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="requests-waiting">
            <h2 id="requests-waiting" className="text-sm font-semibold text-muted-foreground">
              ממתינות ({waiting.length})
            </h2>
            {waiting.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין בקשות שממתינות לטיפול.</p>
            ) : (
              <ul className="space-y-3">{waiting.map(card)}</ul>
            )}
          </section>

          {handled.length > 0 && (
            <section className="space-y-3" aria-labelledby="requests-handled">
              <h2 id="requests-handled" className="text-sm font-semibold text-muted-foreground">
                טופלו ({handled.length})
              </h2>
              <ul className="space-y-3">{handled.map(card)}</ul>
            </section>
          )}
        </>
      )}

      <TripDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        route={null}
        draft={dialog.draft}
        requestIds={dialog.requestIds}
        defaultSortOrder={nextSortOrder}
        onSaved={({ warning }) => {
          setDialog((d) => ({ ...d, open: false }));
          toast({ title: "הטריפ נוצר", description: "הבקשה סומנה כמטופלת. הטריפ מופיע בלשונית הטריפים." });
          if (warning) toast({ variant: "destructive", title: "שימו לב", description: warning });
          refresh();
        }}
      />
    </div>
  );
}
