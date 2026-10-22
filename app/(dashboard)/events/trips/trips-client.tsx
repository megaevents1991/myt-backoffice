"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlusCircle } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { deleteItineraryRoute, setItineraryRouteActive } from "@/lib/actions/itinerary-routes-actions";
import type { ItineraryRouteListItem } from "@/lib/itinerary/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TripDialog, tripDate } from "./trip-dialog";

/**
 * A click on the confirm "מחיקה" counts only this long after the confirm opened. The confirm group renders where
 * the row's own "מחיקה" was, so a fast double-click (mouse or finger) would otherwise land its second click on the
 * red button. Longer than a double-click, far shorter than reading "למחוק את הטריפ?" and deciding.
 */
const CONFIRM_ARM_MS = 400;

/** The status line of a switched-off trip: the site shows no inactive trip, whatever its events are. */
const INACTIVE_TEXT = "כבוי - לא מוצג באתר";

type DialogState = { open: boolean; route: ItineraryRouteListItem | null };

/** The trips, soonest-ordered first as the server sends them; "טריפ חדש", and per row: switch, edit, delete. */
export function TripsClient({ routes }: { routes: ItineraryRouteListItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<DialogState>({ open: false, route: null });
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // The switch answers at once; the list's own value arrives with the refresh below and replaces it.
  const [activeOverride, setActiveOverride] = useState<Record<number, boolean>>({});
  const [refreshing, startRefresh] = useTransition();
  // Focus: a row's "מחיקה" is replaced by the confirm group and back, so the page keeps track of where focus goes.
  const deleteButtons = useRef(new Map<number, HTMLButtonElement>());
  const newTripButton = useRef<HTMLButtonElement>(null);
  // When the confirm last opened (a timestamp, nothing to clean up): see CONFIRM_ARM_MS.
  const confirmOpenedAt = useRef(0);
  const [focusDeleteOf, setFocusDeleteOf] = useState<number | null>(null);

  useEffect(() => {
    setActiveOverride((o) => (Object.keys(o).length > 0 ? {} : o));
  }, [routes]);

  // After "ביטול" the row's own "מחיקה" is mounted again (new element): focus goes back to it once it is there.
  useEffect(() => {
    if (focusDeleteOf === null) return;
    deleteButtons.current.get(focusDeleteOf)?.focus();
    setFocusDeleteOf(null);
  }, [focusDeleteOf]);

  const cancelDelete = (id: number) => {
    setConfirmId(null);
    setFocusDeleteOf(id);
  };

  const dropOverride = (id: number) =>
    setActiveOverride((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });

  const refresh = () => startRefresh(() => router.refresh());
  const locked = busyId !== null || refreshing;

  const warn = (warning: string) =>
    toast({ variant: "destructive", title: "האתר לא התרענן", description: warning });

  async function toggle(route: ItineraryRouteListItem, on: boolean) {
    setBusyId(route.id);
    setActiveOverride((o) => ({ ...o, [route.id]: on }));
    try {
      const res = await setItineraryRouteActive(route.id, on);
      if ("error" in res) {
        dropOverride(route.id);
        toast({ variant: "destructive", title: "השמירה נכשלה", description: res.error });
        return;
      }
      toast({ title: on ? "הטריפ הופעל" : "הטריפ כבוי" });
      if (res.warning) warn(res.warning);
      refresh();
    } catch (e) {
      console.error("setItineraryRouteActive failed", e);
      dropOverride(route.id);
      toast({ variant: "destructive", title: "השמירה נכשלה", description: e instanceof Error ? e.message : "שגיאה לא צפויה" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(route: ItineraryRouteListItem) {
    if (Date.now() - confirmOpenedAt.current < CONFIRM_ARM_MS) return;
    setBusyId(route.id);
    try {
      const res = await deleteItineraryRoute(route.id);
      if ("error" in res) {
        toast({ variant: "destructive", title: "המחיקה נכשלה", description: res.error });
        return;
      }
      setConfirmId(null);
      // The row is about to go: leave focus somewhere that stays.
      newTripButton.current?.focus();
      toast({ title: "הטריפ נמחק" });
      if (res.warning) warn(res.warning);
      refresh();
    } catch (e) {
      console.error("deleteItineraryRoute failed", e);
      toast({ variant: "destructive", title: "המחיקה נכשלה", description: e instanceof Error ? e.message : "שגיאה לא צפויה" });
    } finally {
      setBusyId(null);
    }
  }

  // A new trip starts after the last one in "סדר".
  const nextSortOrder = routes.length === 0 ? 0 : Math.max(...routes.map((r) => r.sortOrder)) + 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-start">
        <Button ref={newTripButton} onClick={() => setDialog({ open: true, route: null })}>
          <PlusCircle className="me-2 h-4 w-4" />
          טריפ חדש
        </Button>
      </div>

      {routes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          עוד אין טריפים - צרו את הראשון
        </div>
      ) : (
        <ul className="space-y-3">
          {routes.map((route) => {
            const active = activeOverride[route.id] ?? route.isActive;
            const site = active ? route.site : { shown: false, text: INACTIVE_TEXT };
            const found = new Set(route.events.map((e) => e.id));
            const missingIds = route.eventIds.filter((id) => !found.has(id));
            const confirming = confirmId === route.id;
            const busy = busyId === route.id;
            return (
              <li key={route.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="text-base font-semibold">
                        <bdi>{route.title}</bdi>
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        סדר <bdi>{route.sortOrder}</bdi>
                      </span>
                    </div>

                    <ol className="space-y-0.5 text-sm">
                      {route.events.map((e) => (
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

                    <p className={cn("text-sm", site.shown ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                      {site.text}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`trip-active-${route.id}`}
                        aria-label={`פעיל: ${route.title}`}
                        checked={active}
                        disabled={locked}
                        onCheckedChange={(on) => toggle(route, on)}
                      />
                      <Label htmlFor={`trip-active-${route.id}`} className="font-normal">
                        פעיל
                      </Label>
                    </div>

                    {/* The two branches are keyed apart on purpose: unkeyed, React reuses the focused "מחיקה"
                        button as the red confirm one, and a second Enter / key repeat / double tap would delete. */}
                    {confirming ? (
                      <div
                        key="confirm"
                        role="alertdialog"
                        aria-label={`אישור מחיקת הטריפ ${route.title}`}
                        aria-describedby={`trip-confirm-${route.id}`}
                        className="flex flex-wrap items-center gap-2"
                        onKeyDown={(ev) => {
                          if (ev.key === "Escape" && !busy) {
                            ev.stopPropagation();
                            cancelDelete(route.id);
                          }
                        }}
                      >
                        <span id={`trip-confirm-${route.id}`} className="text-sm font-medium">
                          למחוק את הטריפ?
                        </span>
                        <Button size="sm" variant="destructive" disabled={locked} onClick={() => remove(route)}>
                          {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                          מחיקה
                        </Button>
                        {/* The safe answer takes focus. */}
                        <Button size="sm" variant="outline" autoFocus disabled={busy} onClick={() => cancelDelete(route.id)}>
                          ביטול
                        </Button>
                      </div>
                    ) : (
                      <div key="actions" className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`עריכה: ${route.title}`}
                          disabled={locked}
                          onClick={() => setDialog({ open: true, route })}
                        >
                          עריכה
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`מחיקה: ${route.title}`}
                          disabled={locked}
                          ref={(el) => {
                            if (el) deleteButtons.current.set(route.id, el);
                            else deleteButtons.current.delete(route.id);
                          }}
                          onClick={() => {
                            confirmOpenedAt.current = Date.now();
                            setConfirmId(route.id);
                          }}
                        >
                          מחיקה
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <TripDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        route={dialog.route}
        defaultSortOrder={nextSortOrder}
        onSaved={({ created, warning }) => {
          setDialog((d) => ({ ...d, open: false }));
          toast({ title: created ? "הטריפ נוצר" : "הטריפ נשמר" });
          if (warning) warn(warning);
          refresh();
        }}
      />
    </div>
  );
}
