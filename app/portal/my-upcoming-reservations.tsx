"use client";

/**
 * V2 dashboard "ההזמנות שלי" (2026-08-27 spec): only FUTURE events, only PAID
 * bookings, sorted by event date nearest→farthest. 10 rows, "הצג עוד" reveals
 * the rest; the full picture stays on /portal/reservations.
 */

import { useState } from "react";
import Link from "next/link";
import type { PortalReservation } from "@/lib/actions/portal-actions";

const dateFmt = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("he-IL") : "-";
const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

export function MyUpcomingReservations({ rows }: { rows: PortalReservation[] }) {
  const [visible, setVisible] = useState(10);

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-bold">ההזמנות שלי</h2>
        <Link
          href="/portal/reservations"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          לכל ההזמנות
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          אין עדיין הזמנות ששולמו לאירועים קרובים.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="py-2 pe-3 font-medium">אירוע</th>
                  <th className="py-2 pe-3 font-medium">תאריך האירוע</th>
                  <th className="py-2 pe-3 font-medium">לקוח</th>
                  <th className="py-2 pe-3 font-medium">כרטיסים</th>
                  <th className="py-2 pe-3 font-medium">סכום</th>
                  <th className="py-2 font-medium">העמלה שלי</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, visible).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="max-w-52 truncate py-2 pe-3 font-medium">
                      {r.event_title ?? "-"}
                    </td>
                    <td className="whitespace-nowrap py-2 pe-3">
                      {dateFmt(r.event_date)}
                    </td>
                    <td className="max-w-40 truncate py-2 pe-3">{r.customer_name}</td>
                    <td className="py-2 pe-3 tabular-nums">{r.tickets}</td>
                    <td className="whitespace-nowrap py-2 pe-3 tabular-nums" dir="ltr">
                      {usd(r.user_shown_price)}
                    </td>
                    <td className="whitespace-nowrap py-2 tabular-nums text-success" dir="ltr">
                      {r.settled_at_charge ? "קוזז בחיוב" : usd(r.commission_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > visible && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + 10)}
              className="mt-3 w-full rounded-lg border border-dashed py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-brand-forest hover:text-foreground dark:hover:border-brand-mint"
            >
              הצג עוד ({rows.length - visible} נוספות)
            </button>
          )}
        </>
      )}
    </section>
  );
}
