"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The portal's event lists open on the few NEAREST matches (they are sorted by
 * date); this closes the list with every other match of the same search, so an
 * agent building a package for a show months away can still reach it.
 */
export function ShowMoreButton({
  hidden,
  onClick,
}: {
  /** Matches of the current search that are not on screen yet. */
  hidden: number;
  onClick: () => void;
}) {
  if (hidden <= 0) return null;
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full rounded-xl"
      onClick={onClick}
    >
      <ChevronDown className="h-4 w-4" />
      הצג עוד
      <span className="text-xs font-normal text-muted-foreground">
        ({hidden.toLocaleString("he-IL")} אירועים נוספים)
      </span>
    </Button>
  );
}
