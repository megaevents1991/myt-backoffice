"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * Busts the customer site's ISR cache so freshly-saved template content (blob
 * art, names, images) shows live without waiting for the hourly revalidate.
 * Hits the backoffice `GET /api/revalidate`, which fans out to myt-main's
 * `/api/revalidate` (no `path` → revalidates homepage, artists, football, blog,
 * category). Same pattern as the events page button.
 */
export function RevalidateButton() {
  const [revalidating, setRevalidating] = useState(false);
  const { toast } = useToast();

  const handleRevalidate = async () => {
    setRevalidating(true);
    try {
      const res = await fetch("/api/revalidate");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to revalidate pages");
      }
      toast({ title: "Live site refreshed", description: "Pages revalidated." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Revalidation failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRevalidating(false);
    }
  };

  return (
    <Button onClick={handleRevalidate} disabled={revalidating} variant="outline">
      <RefreshCw className={`mr-2 h-4 w-4 ${revalidating ? "animate-spin" : ""}`} />
      {revalidating ? "Revalidating…" : "Revalidate live site"}
    </Button>
  );
}
