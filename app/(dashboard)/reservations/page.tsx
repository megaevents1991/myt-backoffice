"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ReservationsTable } from "./reservations-table";

export default function ReservationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservations"
        description="Customer bookings, written here by the customer site at checkout - one row per order, with its package contents, payment status and the partner it came from. Deleting only marks a row deleted; it stays recoverable."
        actions={
          <Link href="/reservations/new">
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Reservation
            </Button>
          </Link>
        }
      />

      <ReservationsTable />
    </div>
  );
}
