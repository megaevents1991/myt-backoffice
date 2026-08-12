"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PortalUserActivity, UserSimulation } from "@/lib/actions/portal-activity-actions";

/** Bottom-of-dashboard user log: one collapsible block per visitor code, one
 *  row per SIMULATION (event explored) - not one row per click. */

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function stepLabel(step: UserSimulation["flight"]): string {
  if (step === "chosen") return "נבחרה";
  if (step === "skipped") return "דילגו";
  return "-";
}

function UserBlock({
  userId,
  lastSeen,
  simulations,
}: {
  userId: string;
  lastSeen: string;
  simulations: UserSimulation[];
}) {
  const [open, setOpen] = useState(false);
  // The order color belongs on the OUTER user row - the inner table row alone
  // is invisible while collapsed (אלון, 2026-08-07, "תראה אצל שגיא").
  const hasPaidOrder = simulations.some((sim) => sim.order === "paid");
  const hasPendingOrder = simulations.some((sim) => sim.order === "pending");
  return (
    <div
      className={`rounded-md border ${
        hasPaidOrder
          ? "border-emerald-300 bg-emerald-50"
          : hasPendingOrder
            ? "border-sky-300 bg-sky-50"
            : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-right transition-colors ${
          hasPaidOrder
            ? "hover:bg-emerald-100/60"
            : hasPendingOrder
              ? "hover:bg-sky-100/60"
              : "hover:bg-muted/50"
        }`}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-sm" dir="ltr">
          {userId}
        </span>
        {hasPaidOrder ? (
          <Badge className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-600">
            הוזמן · שולם
          </Badge>
        ) : hasPendingOrder ? (
          <Badge className="shrink-0 bg-sky-500 text-white hover:bg-sky-500">
            הוזמן · ממתין
          </Badge>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span>{simulations.length} סימולציות</span>
          <span>נראה לאחרונה {formatDateTime(lastSeen)}</span>
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>אירוע</TableHead>
                <TableHead>תאריך אירוע</TableHead>
                <TableHead>כרטיסים</TableHead>
                <TableHead>טיסה</TableHead>
                <TableHead>מלון</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>מתי</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {simulations.map((sim, index) => (
                <TableRow
                  key={index}
                  className={
                    // הוזמנה ושולמה - ירוק; הוזמנה וממתינה - כחול בהיר.
                    sim.order === "paid"
                      ? "bg-emerald-100/70 hover:bg-emerald-100"
                      : sim.order === "pending"
                        ? "bg-sky-100/70 hover:bg-sky-100"
                        : undefined
                  }
                >
                  <TableCell className="max-w-[16rem]">
                    <div className="truncate font-medium">
                      {sim.event || "לא זוהה אירוע"}
                    </div>
                    {sim.event_location && (
                      <div className="truncate text-xs text-muted-foreground">
                        {sim.event_location}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {sim.event_date || "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {sim.num_tickets || sim.tickets_type
                      ? [
                          sim.num_tickets ? `×${sim.num_tickets}` : null,
                          sim.tickets_type,
                        ]
                          .filter(Boolean)
                          .join(" ")
                      : "-"}
                  </TableCell>
                  <TableCell className="text-sm">{stepLabel(sim.flight)}</TableCell>
                  <TableCell className="text-sm">{stepLabel(sim.hotel)}</TableCell>
                  <TableCell>
                    {sim.order === "paid" ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        הוזמן · שולם
                      </Badge>
                    ) : sim.order === "pending" ? (
                      <Badge className="bg-sky-500 text-white hover:bg-sky-500">
                        הוזמן · ממתין
                      </Badge>
                    ) : sim.confirmed ? (
                      <Badge>הגיעו לתשלום</Badge>
                    ) : (
                      <Badge variant="outline">בדקו</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(sim.last_seen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function UserActivityLog({ activity }: { activity: PortalUserActivity }) {
  if (activity.users.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>לוג פעילות משתמשים</CardTitle>
        <CardDescription>
          מה כל מבקר שהגיע דרך הלינקים שלכם בדק בפועל - כל סימולציה בשורה אחת.
          {activity.truncated && " מוצגים המבקרים האחרונים בלבד."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {activity.users.map((user) => (
          <UserBlock
            key={user.user_id}
            userId={user.user_id}
            lastSeen={user.last_seen}
            simulations={user.simulations}
          />
        ))}
      </CardContent>
    </Card>
  );
}
