"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "react-hot-toast";
import { Lock } from "lucide-react";
import {
  getLockableFlights,
  lockEventFlight,
  unlockEventFlight,
  type LockableFlight,
} from "@/lib/actions/event-flight-lock-actions";

export type EventFlightLockProps = {
  eventId: number;
  lockedFlightId: number | null;
  defDateDepart?: string | null;
  defDateReturn?: string | null;
  /** Called after a successful lock/unlock so the page can refresh the event. */
  onChanged?: () => void;
};

export function EventFlightLock({
  eventId,
  lockedFlightId,
  defDateDepart,
  defDateReturn,
  onChanged,
}: EventFlightLockProps) {
  const [locked, setLocked] = useState<number | null>(lockedFlightId ?? null);
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<LockableFlight[]>([]);
  const [choice, setChoice] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => setLocked(lockedFlightId ?? null), [lockedFlightId]);

  useEffect(() => {
    if (!picking) return;
    getLockableFlights(eventId)
      .then(setOptions)
      .catch((error) => {
        console.error("Failed to load lockable flights:", error);
        toast.error("Could not load the linked flights");
      });
  }, [picking, eventId]);

  const lock = (flightId: number) => {
    startTransition(async () => {
      try {
        const { warning } = await lockEventFlight(eventId, flightId);
        setLocked(flightId);
        setPicking(false);
        toast.success("Package locked");
        if (warning) toast(warning, { icon: "⚠️", duration: 6000 });
        onChanged?.();
      } catch (error) {
        console.error("Failed to lock package:", error);
        toast.error(error instanceof Error ? error.message : "Lock failed");
      }
    });
  };

  const unlock = () => {
    if (
      !confirm("Unlock this package? Customers will see live Amadeus search again.")
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await unlockEventFlight(eventId);
        setLocked(null);
        toast.success("Package unlocked");
        onChanged?.();
      } catch (error) {
        console.error("Failed to unlock package:", error);
        toast.error("Unlock failed");
      }
    });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={locked !== null || picking}
          disabled={isPending}
          onCheckedChange={(checked) => {
            if (!checked) {
              if (locked !== null) unlock();
              else setPicking(false);
              return;
            }
            setPicking(true);
          }}
        />
        <span className="font-medium">Locked package</span>
        <span className="text-xs text-muted-foreground">
          one offline flight, no Amadeus search
        </span>
      </label>

      {picking && locked === null && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 max-w-lg rounded-md border bg-background px-2 text-sm"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Choose a linked flight…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.allocated_seats === null
                  ? " — no allocation"
                  : ` — ${option.allocated_seats} seats allocated`}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={isPending || !choice} onClick={() => lock(Number(choice))}>
            Lock
          </Button>
          {options.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Link a flight to this event first.
            </span>
          )}
        </div>
      )}

      {locked !== null && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              Locked package — customers see only flight #{locked}. No Amadeus search.
            </p>
            <p className="text-xs text-muted-foreground">
              Dates fixed to {defDateDepart ?? "—"} → {defDateReturn ?? "—"}. Takes
              effect on the site only once the main-app release is live.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
