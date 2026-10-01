"use client";

import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { useCompany } from "@/contexts/company-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The active company, in the top bar. Only a user who belongs to more than one
 * company gets it - for everyone else (every Mega Events-only user) this
 * renders nothing and the top bar is the one they always had.
 */
export function CompanySwitcher() {
  const { active, companies, isLoading, switchTo } = useCompany();
  const [pending, setPending] = useState<string | null>(null);

  if (isLoading || !active || companies.length <= 1) return null;

  const choose = async (slug: string) => {
    if (slug === active.slug || pending) return;
    setPending(slug);
    // On success the page reloads into the new company; only a failure comes back here.
    await switchTo(slug);
    setPending(null);
  };

  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={pending !== null}
          className="h-8 max-w-[12rem] gap-1.5 px-2.5 text-xs"
          aria-label={`החברה הפעילה: ${active.name}. החלפת חברה`}
          data-testid="company-switcher"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Building2 className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="hidden truncate sm:inline">{active.name}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          החברה הפעילה
        </DropdownMenuLabel>
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            className="gap-2"
            onSelect={() => choose(company.slug)}
          >
            <span className="truncate">{company.name}</span>
            {company.slug === active.slug && <Check className="mr-auto h-3.5 w-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
