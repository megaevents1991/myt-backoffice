"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChevronRight, Search } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { guideLinkFor } from "@/lib/guide-link";
import { breadcrumbsFor } from "@/lib/nav";
import { isToursAgentPath } from "@/lib/auth/tours-agent";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { CompanySwitcher } from "@/components/company-switcher";

/**
 * Persistent header: where am I (breadcrumbs), how do I get elsewhere (search),
 * how does this screen work (the guide, at this screen's section, in a new tab
 * so the screen stays open beside it), and the theme control. Nested routes
 * like /templates/categories/42/edit used to give no clue where they sat.
 */
export function Topbar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isToursAgent = user?.role === TOURS_AGENT_ROLE;
  // A tours_agent sees only the crumbs it may open - the rest would be links
  // that middleware bounces straight back.
  const crumbs = breadcrumbsFor(pathname).filter((crumb) => !isToursAgent || isToursAgentPath(crumb.href));
  // Not on the guide itself, and not for forms_operator or tours_agent
  // (middleware keeps them in /forms and on the departures board).
  const showGuide = !pathname.startsWith("/guide") && user?.role !== "forms_operator" && !isToursAgent;

  return (
    <header className="surface-chrome sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b px-3">
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
        {/* Renders nothing unless the user belongs to more than one company. */}
        <CompanySwitcher />
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
        {showGuide && (
          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 px-2.5 text-xs">
            <a
              href={guideLinkFor(pathname)}
              target="_blank"
              rel="noopener noreferrer"
              title="המדריך של המסך הזה - נפתח בלשונית חדשה"
              aria-label="Guide for this screen (opens in a new tab)"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Guide</span>
            </a>
          </Button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
