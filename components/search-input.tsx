"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Classes for the box around the input - its width, mostly. */
  wrapperClassName?: string;
}

/**
 * The one search box: a leading glass, a clear button once there is text, Esc
 * clears too. Every list screen used to draw its own (different icon offsets,
 * heights and no way to clear), so a reader had to relearn it per screen.
 * Logical sides (`start` / `end`), so an RTL screen mirrors it by itself.
 */
export function SearchInput({
  value,
  onValueChange,
  wrapperClassName,
  className,
  placeholder,
  onKeyDown,
  ...props
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative w-full sm:w-[300px]", wrapperClassName)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        // The placeholder is cut short on a long list of fields - the tooltip
        // still says everything the box searches.
        title={placeholder}
        aria-label={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) onValueChange("");
          onKeyDown?.(event);
        }}
        className={cn("h-9 w-full ps-8 pe-8", className)}
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          className={cn(
            "absolute end-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground",
            "transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
