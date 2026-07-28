"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "react-hot-toast";
import { Loader2 } from "lucide-react";
import type { PaxInfo } from "@/types/reservation.types";
import { updateReservationPaxInfo } from "@/lib/actions/reservation-actions";

export type ReservationPaxEditorProps = {
  reservationId: number;
  /** The main contact — shown read-only, since they are a passenger too. */
  mainContact: { first_name: string; last_name: string };
  pax: PaxInfo[];
};

const GENDERS: PaxInfo["gender"][] = ["M", "F", "X"];

/**
 * Airlines need passport, date of birth and gender to issue a ticket. The main
 * app's checkout only collects names, so staff complete the rest here and the
 * ticketing export reads it back out.
 */
export function ReservationPaxEditor({
  reservationId,
  mainContact,
  pax,
}: ReservationPaxEditorProps) {
  const [rows, setRows] = useState<PaxInfo[]>(pax ?? []);
  const [isPending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<PaxInfo>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = () => {
    startTransition(async () => {
      try {
        await updateReservationPaxInfo(reservationId, rows);
        toast.success("Passenger details saved");
      } catch (error) {
        console.error("Failed to save passenger details:", error);
        toast.error(error instanceof Error ? error.message : "Save failed");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Passengers</p>

      <div className="rounded-md border p-3 text-sm">
        <span className="font-medium">
          {mainContact.first_name} {mainContact.last_name}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          main contact — edit on the reservation edit screen
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No additional passengers.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 md:grid-cols-4">
              <label className="text-xs">
                First name
                <Input
                  className="mt-1 h-8"
                  value={row.first_name ?? ""}
                  onChange={(e) => update(index, { first_name: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Last name
                <Input
                  className="mt-1 h-8"
                  value={row.last_name ?? ""}
                  onChange={(e) => update(index, { last_name: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Passport no.
                <Input
                  className="mt-1 h-8"
                  value={row.passport_number ?? ""}
                  onChange={(e) => update(index, { passport_number: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Passport expiry
                <Input
                  className="mt-1 h-8"
                  type="date"
                  value={row.passport_expiry ?? ""}
                  onChange={(e) => update(index, { passport_expiry: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Date of birth
                <Input
                  className="mt-1 h-8"
                  type="date"
                  value={row.date_of_birth ?? ""}
                  onChange={(e) => update(index, { date_of_birth: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Gender
                <select
                  className="mt-1 block h-8 w-full rounded-md border bg-background px-2 text-sm"
                  value={row.gender ?? ""}
                  onChange={(e) =>
                    update(index, {
                      gender: (e.target.value || null) as PaxInfo["gender"],
                    })
                  }
                >
                  <option value="">—</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g ?? ""}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Nationality
                <Input
                  className="mt-1 h-8"
                  maxLength={2}
                  placeholder="IL"
                  value={row.nationality ?? ""}
                  onChange={(e) =>
                    update(index, { nationality: e.target.value.toUpperCase() })
                  }
                />
              </label>
            </div>
          ))}
          <Button size="sm" disabled={isPending} onClick={save}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save passenger details
          </Button>
        </div>
      )}
    </div>
  );
}
