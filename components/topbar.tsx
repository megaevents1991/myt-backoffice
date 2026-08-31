"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";

import { breadcrumbsFor } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Persistent header: where am I (breadcrumbs), how do I get elsewhere (search),
 * and the theme control. Nested routes like /templates/categories/42/edit used
 * to give no clue where they sat.
 */
export function Topbar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="h-8 w-8" />
      <Separator orientation="vertical" className="mr-1 h-4" />

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={crumb.href}>
              {index > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="truncate font-semibold text-foreground"
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hidden truncate text-muted-foreground transition-colors hover:text-foreground sm:inline"
                >
                  {crumb.label}
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSearch}
          className="hidden h-8 gap-2 px-2.5 text-xs text-muted-foreground md:flex"
        >
          <Search className="h-3.5 w-3.5" />
          Search
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSearch}
          className="h-8 w-8 md:hidden"
          aria-label="Search pages"
        >
          <Search className="h-4 w-4" />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
