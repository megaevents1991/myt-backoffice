import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InventoryReservation } from "@/lib/actions/reservation-actions";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status?.toLowerCase() ?? "";
  if (s === "cancelled") return "destructive";
  if (s === "confirmed" || s === "paid") return "default";
  return "secondary";
}

export function ReservationsForInventory({
  reservations,
}: {
  reservations: InventoryReservation[];
}) {
  return (
    <div className="mt-6 bg-card shadow overflow-hidden sm:rounded-lg border">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-2xl leading-6 font-bold text-card-foreground">
          Reservations
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {reservations.length === 0
            ? "No customers have reserved this inventory yet."
            : `${reservations.length} reservation${reservations.length === 1 ? "" : "s"} consuming this inventory.`}
        </p>
      </div>

      {reservations.length > 0 && (
        <div className="border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Main Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Pax</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((r) => {
                const pax = 1 + (r.more_pax_info?.length ?? 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/reservations/${r.id}`}
                        className="hover:underline text-primary"
                      >
                        {r.id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      {r.main_contact_first_name} {r.main_contact_last_name}
                    </TableCell>
                    <TableCell className="text-sm">{r.main_contact_email}</TableCell>
                    <TableCell className="text-sm">{r.main_contact_phone_number}</TableCell>
                    <TableCell>{pax}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status || "—"}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
