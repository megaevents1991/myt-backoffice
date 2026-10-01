"use client";

/**
 * Card tab "טיסות": the flight blocks that carry this departure, and the
 * dialog-less "allocate a block" panel.
 *
 * A block fits only when both ends land in the departure's cities (compared by
 * city, so LTN and LHR are both London) and it still has seats to give. The
 * panel shows why a block does not fit; the server action decides.
 */
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-provider";
import { cn } from "@/lib/utils";
import { checkBlockFitsDeparture, flightRouteLabel } from "@/lib/tours/routes";
import { BLOCK_STATUS_LABELS, LIVE_BLOCK_STATUSES, type BlockStatus } from "@/types/tours.types";
import { addFlightAllocation, listCandidateBlocks, removeFlightAllocation } from "@/lib/actions/tours-departure-actions";
import { fmtDateTime, type RouteEnds } from "./departure-utils";
import { LEGS_LABELS, type AllocationLegs, type CandidateBlock, type CardFlight, type DepartureCardData } from "./types";
import { Chip, Ltr, Notice, selectClass } from "./ui-bits";

const LEGS: AllocationLegs[] = ["both", "outbound", "inbound"];

function BlockStatusChip({ flight }: { flight: Pick<CardFlight, "block_status" | "is_deleted"> }) {
  const status = flight.block_status as BlockStatus | null;
  const live = !flight.is_deleted && status != null && LIVE_BLOCK_STATUSES.includes(status);
  const dead = flight.is_deleted || status === "cancelled" || status === "declined";
  return (
    <Chip
      className={cn(
        live && "border-success/30 bg-success-muted text-success",
        dead && "border-destructive/30 bg-destructive/10 text-destructive",
        !live && !dead && "border-warning/40 bg-warning-muted text-warning",
      )}
    >
      {flight.is_deleted ? "Deleted" : status ? BLOCK_STATUS_LABELS[status] : "Draft"}
    </Chip>
  );
}

function FlightLines({ flight }: { flight: CardFlight }) {
  return (
    <div className="text-xs text-muted-foreground">
      <div>
        Outbound: <Ltr className="font-mono text-foreground">{flight.outbound_flight_number}</Ltr>{" "}
        <Ltr className="tabular-nums">{fmtDateTime(flight.outbound_departure_time)}</Ltr>
      </div>
      <div>
        Return: <Ltr className="font-mono text-foreground">{flight.inbound_flight_number}</Ltr>{" "}
        <Ltr className="tabular-nums">{fmtDateTime(flight.inbound_departure_time)}</Ltr>
      </div>
    </div>
  );
}

/** The widest leg choice this block can serve for the departure, and why not when none. */
function bestLegs(block: CardFlight, route: RouteEnds): { legs: AllocationLegs | null; reason?: string } {
  const both = checkBlockFitsDeparture(block, route, "both");
  if (both.ok) return { legs: "both" };
  if (checkBlockFitsDeparture(block, route, "outbound").ok) return { legs: "outbound", reason: both.reason };
  if (checkBlockFitsDeparture(block, route, "inbound").ok) return { legs: "inbound", reason: both.reason };
  return { legs: null, reason: both.reason };
}

const freeSeats = (block: CardFlight, legs: AllocationLegs): number => {
  const out = block.initial_quantity - block.allocatedOutbound;
  const back = block.initial_quantity - block.allocatedInbound;
  return legs === "outbound" ? out : legs === "inbound" ? back : Math.min(out, back);
};

function CandidateRow({
  block,
  route,
  disabled,
  onAdd,
}: {
  block: CandidateBlock;
  route: RouteEnds;
  disabled: boolean;
  onAdd: (block: CandidateBlock, seats: number, legs: AllocationLegs) => Promise<void>;
}) {
  const best = bestLegs(block, route);
  const [legs, setLegs] = useState<AllocationLegs>(best.legs ?? "both");
  const free = freeSeats(block, legs);
  const [seats, setSeats] = useState(String(Math.max(free, 0)));
  const fit = checkBlockFitsDeparture(block, route, legs);
  const [adding, setAdding] = useState(false);
  const seatsNumber = Number(seats);

  return (
    <tr className={cn("border-t align-top", !fit.ok && "bg-destructive/5")} data-flight-id={block.id}>
      <td className="px-2 py-2">
        <BlockStatusChip flight={block} />
        <div className="mt-1 text-xs text-muted-foreground">
          <Ltr>#{block.id}</Ltr>
        </div>
      </td>
      <td className="px-2 py-2">
        <Ltr className="font-mono text-xs font-semibold">{flightRouteLabel(block)}</Ltr>
        <FlightLines flight={block} />
        {!fit.ok && <p className="mt-1 text-xs font-medium text-destructive">{fit.reason}</p>}
        {block.alreadyAllocated && <p className="mt-1 text-xs text-muted-foreground">Already allocated to this departure</p>}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-center text-xs tabular-nums">
        <Ltr>
          {Math.max(free, 0)} / {block.initial_quantity}
        </Ltr>
        <div className="text-muted-foreground">Left / in block</div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Direction"
            className={`${selectClass} h-8 text-xs`}
            value={legs}
            onChange={(e) => {
              const next = e.target.value as AllocationLegs;
              setLegs(next);
              setSeats(String(Math.max(freeSeats(block, next), 0)));
            }}
          >
            {LEGS.map((l) => (
              <option key={l} value={l}>
                {LEGS_LABELS[l]}
              </option>
            ))}
          </select>
          <Input
            dir="ltr"
            inputMode="numeric"
            aria-label="Number of seats"
            className="h-8 w-16 text-end"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
          <Button
            size="sm"
            variant={fit.ok ? "default" : "outline"}
            className="h-8"
            disabled={disabled || adding || !Number.isInteger(seatsNumber) || seatsNumber < 1}
            onClick={async () => {
              setAdding(true);
              await onAdd(block, seatsNumber, legs);
              setAdding(false);
            }}
          >
            {adding ? <Loader2 className="animate-spin" /> : <Plus />}
            Allocate
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function CardFlightsTab({
  data,
  route,
  onSaved,
}: {
  data: DepartureCardData;
  route: RouteEnds;
  onSaved: () => Promise<void>;
}) {
  const d = data.departure;
  const confirm = useConfirm();
  const [candidates, setCandidates] = useState<CandidateBlock[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showUnfit, setShowUnfit] = useState(false);
  const readOnly = Boolean(d.is_deleted);

  const loadCandidates = async () => {
    setLoading(true);
    const result = await listCandidateBlocks(d.id);
    setLoading(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setCandidates(result.data);
  };

  const add = async (block: CandidateBlock, seats: number, legs: AllocationLegs) => {
    const result = await addFlightAllocation(d.id, block.id, seats, legs);
    if (!result.success) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    if (result.warning) toast(`Block allocated. Note: ${result.warning}`, { duration: 8000 });
    else toast.success("Block allocated to the departure");
    await Promise.all([onSaved(), loadCandidates()]);
  };

  const remove = async (allocationId: string, label: string) => {
    const agreed = await confirm({
      title: "Remove this allocation?",
      description: `Block ${label} will stop serving departure ${d.code}. The block itself is not deleted and the seats return to the pool.`,
      confirmLabel: "Remove Allocation",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!agreed) return;
    setRemoving(allocationId);
    const result = await removeFlightAllocation(allocationId);
    setRemoving(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Allocation removed");
    await Promise.all([onSaved(), candidates ? loadCandidates() : Promise.resolve()]);
  };

  const fitting = (candidates ?? []).filter((c) => !c.alreadyAllocated && bestLegs(c, route).legs !== null);
  const unfit = (candidates ?? []).filter((c) => !c.alreadyAllocated && bestLegs(c, route).legs === null);

  return (
    <div className="space-y-4 py-4">
      {data.stats.liveBlocks === 0 && (
        <Notice tone={d.is_published ? "error" : "warning"}>
          The departure has no live flight block{data.allocations.length > 0 ? " - the allocated blocks are not in an approved status" : ""}.
          {d.is_published ? " It is published, and the site shows \"flight details will be updated\"." : ""}
        </Notice>
      )}

      {data.allocations.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No blocks allocated to this departure.</p>
      ) : (
        <ul className="space-y-2">
          {data.allocations.map((a) => {
            const label = `${a.flight.airline_code} ${a.flight.outbound_flight_number}`;
            return (
              <li key={a.id} data-allocation-flight={a.flight.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-md border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Ltr className="font-mono text-sm font-semibold">{flightRouteLabel(a.flight)}</Ltr>
                    <BlockStatusChip flight={a.flight} />
                    {a.legs !== "both" && <Chip>{LEGS_LABELS[a.legs]}</Chip>}
                  </div>
                  <FlightLines flight={a.flight} />
                </div>
                <div className="text-center text-sm tabular-nums">
                  <div className="font-semibold">{a.seats}</div>
                  <div className="text-xs text-muted-foreground">
                    seats, of <Ltr>{a.flight.initial_quantity}</Ltr> in the block
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8" asChild>
                    <Link href={`/offline-flights/${a.flight.id}`} target="_blank" title="Open the block card in a new tab">
                      <ExternalLink />
                      Block <Ltr>#{a.flight.id}</Ltr>
                    </Link>
                  </Button>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title="Remove allocation"
                      disabled={removing === a.id}
                      onClick={() => remove(a.id, label)}
                    >
                      {removing === a.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div className="space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Allocate a Flight Block</h3>
              <p className="text-xs text-muted-foreground">The company&apos;s blocks that fly within two days of the departure dates. Both ends are checked, by city.</p>
            </div>
            <Button size="sm" variant="outline" onClick={loadCandidates} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Plus />}
              {candidates ? "Refresh List" : "Find Matching Blocks"}
            </Button>
          </div>

          {candidates && fitting.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No free block matches the route and dates of this departure.
            </p>
          )}
          {candidates && fitting.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm" data-testid="candidate-blocks">
                <tbody>
                  {fitting.map((c) => (
                    <CandidateRow key={c.id} block={c} route={route} disabled={false} onAdd={add} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {candidates && unfit.length > 0 && (
            <div className="space-y-2">
              <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setShowUnfit((v) => !v)}>
                {showUnfit ? "Hide" : "Show"} {unfit.length} blocks on the same dates that don&apos;t match the route
              </button>
              {showUnfit && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm" data-testid="unfit-blocks">
                    <tbody>
                      {unfit.map((c) => (
                        <CandidateRow key={c.id} block={c} route={route} disabled={false} onAdd={add} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
