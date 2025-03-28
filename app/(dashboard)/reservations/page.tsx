"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { ReservationsTable } from "./reservations-table";

export default function ReservationsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reservations</h1>
          <p className="text-muted-foreground">
            View and manage customer reservations.
          </p>
        </div>
        <Link href="/reservations/new">
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Reservation
          </Button>
        </Link>
      </div>

      <ReservationsTable />
    </div>
  );
}
