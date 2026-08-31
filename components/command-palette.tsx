"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { visibleGroups } from "@/lib/nav";
import { useAuth } from "@/contexts/auth-context";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/**
 * Ctrl/Cmd-K jump to any screen. With 20+ destinations, hunting the sidebar was
 * the slowest part of moving around the backoffice.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const groups = visibleGroups(user?.role);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Go to page…" />
      <CommandList>
        <CommandEmpty>No page matches that.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.flatMap((item) => {
              // A parent with children is not a destination of its own - list
              // the children, which are the real screens.
              const entries = item.items?.length ? item.items : [item];
              return entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <CommandItem
                    key={entry.href}
                    value={`${entry.name} ${entry.href} ${entry.keywords ?? ""}`}
                    onSelect={() => go(entry.href)}
                    className="gap-2"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span>{entry.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {entry.href}
                    </span>
                  </CommandItem>
                );
              });
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
