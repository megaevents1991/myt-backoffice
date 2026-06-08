"use client";

import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InventoryReservation } from "@/lib/actions/reservation-actions";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status?.toLowerCase() ?? "";
  if (s === "cancelled" || s === "lost") return "destructive";
  if (s === "confirmed" || s === "paid") return "default";
  return "secondary";
}

type Passenger = { name: string; reservationId: number; status: string };

// Flattens active reservations into a numbered passenger manifest grouped by
// reservation — prep for the flights team's group ticketing. Main contact comes
// first in each reservation, followed by the extra pax.
function buildManifest(reservations: InventoryReservation[]) {
  const groups = reservations.map((r) => {
    const names: string[] = [];
    const main = `${r.main_contact_first_name ?? ""} ${r.main_contact_last_name ?? ""}`.trim();
    if (main) names.push(main);
    for (const p of r.more_pax_info ?? []) {
      const n = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      if (n) names.push(n);
    }
    // Fall back to a single unnamed seat so the count still reflects the pax.
    if (names.length === 0) names.push("(unnamed passenger)");
    return { reservationId: r.id, status: r.status || "—", names };
  });
  const totalPax = groups.reduce((sum, g) => sum + g.names.length, 0);
  return { groups, totalPax };
}

export function FlightPassengerManifest({
  reservations,
}: {
  reservations: InventoryReservation[];
}) {
  const [copied, setCopied] = useState(false);
  const { groups, totalPax } = useMemo(() => buildManifest(reservations), [reservations]);

  const copyText = useMemo(() => {
    let seq = 0;
    return groups
      .map((g) => {
        const header = `Reservation ${g.reservationId} — ${g.status}`;
        const lines = g.names.map((n) => `  ${++seq}. ${n} (Res ${g.reservationId})`);
        return [header, ...lines].join("\n");
      })
      .join("\n");
  }, [groups]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      toast.success("Manifest copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  let seq = 0;

  return (
    <div className="mt-6 bg-card shadow overflow-hidden sm:rounded-lg border">
      <div className="px-4 py-5 sm:px-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl leading-6 font-bold text-card-foreground">
            Passenger Manifest
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalPax === 0
              ? "No active passengers on this flight yet."
              : `${totalPax} passenger${totalPax === 1 ? "" : "s"} across ${groups.length} reservation${groups.length === 1 ? "" : "s"} · for group ticketing.`}
          </p>
        </div>
        {totalPax > 0 && (
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied" : "Copy list"}
          </Button>
        )}
      </div>

      {totalPax > 0 && (
        <div className="border-t border-border divide-y divide-border">
          {groups.map((g) => (
            <div key={g.reservationId} className="px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold">Reservation {g.reservationId}</span>
                <Badge variant={statusVariant(g.status)}>{g.status}</Badge>
              </div>
              <ol className="space-y-1">
                {g.names.map((name, i) => {
                  seq += 1;
                  return (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-6 text-right tabular-nums text-muted-foreground">{seq}.</span>
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">Res {g.reservationId}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
