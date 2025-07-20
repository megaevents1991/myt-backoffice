"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PlusCircle, RefreshCw } from "lucide-react";
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

      const result = await response.json();

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Manage your events and their details.
          </p>
        </div>
        <div className="flex items-center space-x-4">
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
        </div>
      </div>

      <EventsTable />
    </div>
  );
}
