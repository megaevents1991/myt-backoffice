"use client";

/**
 * The block card page (/tours/flights/[id]): the flight in both directions at the
 * top, the operations panel under it. The header is drawn from the panel's own
 * data (onLoaded), so the page reads the block once and stays in step with it.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { flightRouteLabel } from "@/lib/tours/routes";
import { formatDateShort } from "@/lib/tours/deadlines";
import type { TourBlockData } from "@/lib/actions/tours-flight-actions";
import { BlockStatusBadge, Ltr, timeOf } from "@/components/tours/flights/block-ui";
import { TourBlockPanel } from "@/components/tours/flights/tour-block-panel";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

const orDash = (value: string | null | undefined) => (value?.trim() ? value : "-");

export function TourBlockView({ flightId }: { flightId: number }) {
  const [data, setData] = useState<TourBlockData | null>(null);
  const block = data?.block ?? null;
  const airline = block
    ? [block.airline_code, block.inbound_airline_code].filter((code, i, all) => code && all.indexOf(code) === i).join(" + ")
    : "";

  return (
    <div>
      <PageHeader
        eyebrow="Flight block"
        title={
          block ? (
            <span className="flex flex-wrap items-center gap-3">
              <Ltr>{flightRouteLabel(block)}</Ltr>
              <BlockStatusBadge status={block.block_status} />
            </span>
          ) : (
            `Flight block ${flightId}`
          )
        }
        description={
          block
            ? [block.series_name, block.season_label].filter(Boolean).join(" · ") || undefined
            : undefined
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/offline-flights">
              <ArrowLeft className="h-4 w-4" />
              Back to Flights
            </Link>
          </Button>
        }
      />

      {/* Until the block arrives the panel below shows the loading (or the error) state. */}
      {block && (
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
          <Detail label="Outbound">
            <Ltr>
              {formatDateShort(block.outbound_departure_time)} {timeOf(block.outbound_departure_time)}
            </Ltr>
            <div className="text-xs font-normal text-muted-foreground">
              <Ltr>
                {block.outbound_flight_number} · {block.outbound_departure_airport}→{block.outbound_arrival_airport}
              </Ltr>
            </div>
          </Detail>
          <Detail label="Return">
            <Ltr>
              {formatDateShort(block.inbound_departure_time)} {timeOf(block.inbound_departure_time)}
            </Ltr>
            <div className="text-xs font-normal text-muted-foreground">
              <Ltr>
                {block.inbound_flight_number} · {block.inbound_departure_airport}→{block.inbound_arrival_airport}
              </Ltr>
            </div>
          </Detail>
          <Detail label="Airline">
            <Ltr>{airline}</Ltr>
            {block.metadata_name && (
              <div className="text-xs font-normal text-muted-foreground">{block.metadata_name}</div>
            )}
          </Detail>
          <Detail label="PNR">
            <Ltr>{orDash(block.pnr)}</Ltr>
          </Detail>
          <Detail label="Group ID">
            <Ltr>{orDash(block.group_code)}</Ltr>
          </Detail>
          <Detail label="Seats">
            <span className="tabular-nums">{block.initial_quantity}</span>
            {block.original_quantity !== null && block.original_quantity !== block.initial_quantity && (
              <span className="text-xs font-normal text-muted-foreground"> of {block.original_quantity}</span>
            )}
          </Detail>
          {block.notes?.trim() && (
            <div className="col-span-full min-w-0">
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm [unicode-bidi:plaintext]">
                {block.notes}
              </dd>
            </div>
          )}
        </dl>
      )}

      <TourBlockPanel flightId={flightId} onLoaded={setData} />
    </div>
  );
}
