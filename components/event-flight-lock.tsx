"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "react-hot-toast";
import { useConfirm } from "@/components/confirm-provider";
import { Lock, LockOpen, Loader2 } from "lucide-react";
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
  const [options, setOptions] = useState<LockableFlight[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();

  useEffect(() => setLocked(lockedFlightId ?? null), [lockedFlightId]);

  // Load the linked flights whenever the panel needs to name one — while
  // picking, and while locked so the banner can describe the flight rather than
  // just print its id.
  useEffect(() => {
    if (!picking && locked === null) return;
    if (options !== null) return;
    getLockableFlights(eventId)
      .then(setOptions)
      .catch((error) => {
        console.error("Failed to load lockable flights:", error);
        toast.error("Could not load the linked flights");
        setOptions([]);
      });
  }, [picking, locked, options, eventId]);

  const lockedFlight = options?.find((o) => o.id === locked) ?? null;

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

  const unlock = async () => {
    if (
      !(await confirm({
        title: "Unlock this package?",
        description: "Customers will see live flight search again.",
        confirmLabel: "Unlock",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await unlockEventFlight(eventId);
        setLocked(null);
        setPicking(false);
        toast.success("Package unlocked");
        onChanged?.();
      } catch (error) {
        console.error("Failed to unlock package:", error);
        toast.error("Unlock failed");
      }
    });
  };

  const isLocked = locked !== null;

  return (
    <div className="rounded-md border">
      {/* header — the switch is the only control until a decision is needed */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          {isLocked ? (
            <Lock className="h-4 w-4 text-amber-600" />
          ) : (
            <LockOpen className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">Locked package</span>
        </div>

        {isLocked && (
          <Badge className="border-amber-500/50 bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200">
            Flight #{locked}
          </Badge>
        )}

        <span className="text-xs text-muted-foreground">
          {isLocked
            ? "Customers see only this flight — no live search."
            : "Sell exactly one offline flight instead of a live flight search."}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            checked={isLocked || picking}
            disabled={isPending}
            aria-label="Locked package"
            onCheckedChange={(checked) => {
              if (checked) {
                setPicking(true);
                return;
              }
              if (isLocked) void unlock();
              else setPicking(false);
            }}
          />
        </div>
      </div>

      {/* picker — only while choosing */}
      {picking && !isLocked && (
        <div className="border-t px-4 py-3">
          {options === null ? (
            <p className="text-sm text-muted-foreground">Loading linked flights…</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Link a flight to this event first — then you can lock the package to it.
            </p>
          ) : (
            <ul className="divide-y">
              {options.map((option) => (
                <li
                  key={option.id}
                  className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    #{option.id}
                  </span>
                  <span className="text-sm">{option.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {option.allocated_seats === null
                      ? "global pool"
                      : `${option.allocated_seats} seats allocated`}
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    disabled={isPending}
                    onClick={() => lock(option.id)}
                  >
                    Lock to this
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* locked detail */}
      {isLocked && (
        <div className="border-t bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
          <p className="text-sm">
            {lockedFlight ? lockedFlight.label : `Flight #${locked}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Package dates fixed to {defDateDepart ?? "—"} → {defDateReturn ?? "—"}.
            When this flight sells out the package shows as sold out — it never falls
            back to a live search, which would change the price.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Takes effect on the site once the main-app release is live.
          </p>
        </div>
      )}
    </div>
  );
}
