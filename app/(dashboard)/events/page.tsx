"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PlusCircle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EventsTable } from "./events-table";
import { useToast } from "@/components/ui/use-toast";

export default function EventsPage() {
    const [revalidating, setRevalidating] = useState(false);
    const { toast } = useToast();
  
    const handleRevalidate = async () => {
    setRevalidating(true);
    try {
      const response = await fetch('/api/revalidate', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to revalidate pages');
      }

      toast({
        title: "Pages revalidated",
        description: "Static pages have been successfully regenerated.",
      });
    } catch (error) {
      console.error("Error revalidating pages:", error);
      toast({
        variant: "destructive",
        title: "Revalidation failed",
        description: error instanceof Error ? error.message : "Failed to revalidate pages. Please try again.",
      });
    } finally {
      setRevalidating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Every sellable event - synced in from XS2E, LiveTickets, P1 and TixStock, or created here by hand. The prices on these rows are the BASE the customer site builds its final price on, and deleting is always a soft delete."
        actions={
          <>
            <Button
              onClick={handleRevalidate}
              disabled={revalidating}
              variant="outline"
            >
              {revalidating ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {revalidating ? "Revalidating..." : "Revalidate Pages"}
            </Button>
            <Link href="/events/new">
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Event
              </Button>
            </Link>
          </>
        }
      />

      <EventsTable />
    </div>
  );
}
