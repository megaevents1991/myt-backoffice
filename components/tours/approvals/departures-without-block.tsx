"use client";

/**
 * Section 2 of the approvals screen: departures that are on the site and have
 * no live flight block. For each one the server looked for live blocks of the
 * company that land and return in the departure's cities, fly within two days
 * of its dates and still have free seats; one click allocates the block with
 * the same action the departure card uses (addFlightAllocation).
 */
import { useState } from "react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { addFlightAllocation } from "@/lib/actions/tours-departure-actions";
import type { ApprovalsData, BlockCandidate, DepartureWithoutBlock } from "@/lib/actions/tours-approvals-actions";
import { daysBetween, formatDateShort } from "@/lib/tours/deadlines";
import { BlockStatusBadge, Ltr } from "@/components/tours/flights/block-ui";
import {
  ActionButton,
  OpenLink,
  QueueSection,
  blockHref,
  departureHref,
  inDays,
  linkClass,
  type QueueControls,
} from "./queue-ui";

export function DeparturesWithoutBlock({ data, run, busy }: QueueControls & { data: ApprovalsData }) {
  const rows = data.departuresWithoutBlock;
  return (
    <QueueSection
      id="no-block"
      title="יציאות מפורסמות בלי קבוצת טיסה פעילה"
      count={rows.length}
      description='יציאות עתידיות שמוצגות באתר, ואף קבוצת טיסה מאושרת לא משויכת אליהן - האתר מציג להן "פרטי הטיסות יעודכנו". לכל יציאה מוצעות קבוצות חיות של החברה שנוחתות וחוזרות בערים שלה, טסות עד יומיים מהתאריכים שלה ועוד יש בהן מושבים פנויים.'
    >
      <ul className="divide-y">
        {rows.map((departure) => (
          <DepartureItem key={departure.id} departure={departure} today={data.today} run={run} busy={busy} />
        ))}
      </ul>
    </QueueSection>
  );
}

function DepartureItem({
  departure,
  today,
  run,
  busy,
}: QueueControls & { departure: DepartureWithoutBlock; today: string }) {
  return (
    <li data-departure={departure.code} className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={departureHref(departure.code, "flights")} className={linkClass} title="פתיחת כרטיס היציאה">
            <Ltr className="font-mono">{departure.code}</Ltr>
          </Link>
          {departure.packageName && <span className="truncate text-sm">{departure.packageName}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <Ltr>
            {formatDateShort(departure.startDate)} - {formatDateShort(departure.endDate)}
          </Ltr>
          {" · "}
          {inDays(daysBetween(today, departure.startDate))}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          מסלול <Ltr className="font-medium text-foreground/80">{departure.route || "לא הוגדר"}</Ltr>
          {departure.deadBlocks > 0 && (
            <> · {departure.deadBlocks === 1 ? "קבוצה אחת משויכת, לא חיה" : `${departure.deadBlocks} קבוצות משויכות, אף אחת לא חיה`}</>
          )}
        </div>
      </div>

      <div className="min-w-0">
        {departure.candidates.length === 0 ? (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {departure.fullCandidates > 0
              ? departure.fullCandidates === 1
                ? "נמצאה קבוצה חיה שמתאימה בתאריכים ובערים, אבל כל המושבים שלה כבר משויכים ליציאות אחרות."
                : `נמצאו ${departure.fullCandidates} קבוצות חיות שמתאימות בתאריכים ובערים, אבל כל המושבים שלהן כבר משויכים ליציאות אחרות.`
              : "לא נמצאה קבוצת טיסה חיה שמתאימה לתאריכים ולערים של היציאה. צריך להזמין קבוצה, או להסיר את היציאה מהאתר."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {departure.candidates.map((candidate) => (
              <CandidateRow
                key={candidate.flightId}
                departure={departure}
                candidate={candidate}
                run={run}
                busy={busy}
              />
            ))}
            {departure.moreCandidates > 0 && (
              <li className="text-xs text-muted-foreground">
                ועוד {departure.moreCandidates} קבוצות מתאימות - בכרטיס היציאה, בלשונית טיסות.
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex items-start justify-end">
        <OpenLink href={departureHref(departure.code, "flights")}>כרטיס היציאה</OpenLink>
      </div>
    </li>
  );
}

function CandidateRow({
  departure,
  candidate,
  run,
  busy,
}: QueueControls & { departure: DepartureWithoutBlock; candidate: BlockCandidate }) {
  const [seats, setSeats] = useState(String(candidate.suggestedSeats));
  const count = /^\d+$/.test(seats.trim()) ? Number(seats.trim()) : Number.NaN;
  const valid = Number.isInteger(count) && count >= 1 && count <= candidate.freeSeats;
  const key = `allocate:${departure.id}:${candidate.flightId}`;
  const airlines = candidate.inboundAirline ? `${candidate.airline} / ${candidate.inboundAirline}` : candidate.airline;
  const flights = [candidate.outboundFlight, candidate.inboundFlight].filter(Boolean).join(" · ");
  const exact = candidate.gapOut === 0 && candidate.gapIn === 0;
  const inputId = `seats-${departure.id}-${candidate.flightId}`;

  return (
    <li
      data-candidate={candidate.flightId}
      className="grid items-center gap-x-4 gap-y-2 rounded-md border bg-background px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Ltr className="font-semibold">{airlines}</Ltr>
          <Ltr className="font-medium">{candidate.route}</Ltr>
          {candidate.status !== "confirmed" && <BlockStatusBadge status={candidate.status} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Ltr>
            {formatDateShort(candidate.outboundDate)} - {formatDateShort(candidate.inboundDate)}
          </Ltr>
          {exact ? (
            <span>אותם תאריכים</span>
          ) : (
            <span className="font-medium text-amber-700 dark:text-amber-400">{gapText(candidate)}</span>
          )}
          {flights && <Ltr>{flights}</Ltr>}
          <span>
            {candidate.freeSeats} פנויים מתוך {candidate.seats}
          </span>
          <Link href={blockHref(candidate.flightId)} className={linkClass}>
            <span dir="auto">{candidate.seriesName ?? `קבוצה ${candidate.flightId}`}</span>
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          מושבים
        </label>
        <Input
          id={inputId}
          dir="ltr"
          inputMode="numeric"
          className="h-9 w-16 text-center tabular-nums"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          disabled={busy !== null}
          aria-invalid={!valid}
        />
        <ActionButton
          actionKey={key}
          busy={busy}
          disabled={!valid}
          title={valid ? undefined : `אפשר לשייך בין 1 ל-${candidate.freeSeats} מושבים`}
          onClick={() =>
            void run(
              key,
              () => addFlightAllocation(departure.id, candidate.flightId, count, "both"),
              `${count} מושבים שויכו ליציאה ${departure.code}`,
            )
          }
        >
          שיוך ליציאה
        </ActionButton>
      </div>
    </li>
  );
}

function gapText(candidate: BlockCandidate): string {
  const days = (n: number) => (n === 1 ? "יום" : `${n} ימים`);
  const parts: string[] = [];
  if (candidate.gapOut > 0) parts.push(`הלוך בהפרש של ${days(candidate.gapOut)}`);
  if (candidate.gapIn > 0) parts.push(`חזור בהפרש של ${days(candidate.gapIn)}`);
  return parts.join(", ");
}
