"use client";

/**
 * Keeps a company that sells tours and no events (Mega Family) inside its own
 * screens: the Tours module and the company-scoped flights list. Every other
 * dashboard screen is a Mega Events feature - the auth guards refuse it to a
 * member of a tours company (worksInMegaEvents in lib/auth/guards.ts) and the
 * sidebar does not offer it - so a stray URL, a bookmark or the post-login
 * landing on /dashboard is sent to the Tours overview instead of an error.
 *
 * Mega Events is untouched: while the company is unknown, or sells events, the
 * page renders at once exactly as before.
 *
 * A URL that carries a company deep link (`?company=<slug>`, see
 * contexts/company-context.tsx) is held behind the loader until the company is
 * known and, when the link names another company of the viewer, until the page
 * has loaded again in it - so the wrong company's "not found" never flashes.
 *
 * A tours_agent that no company was assigned to works nowhere: it gets a
 * notice here instead of the page (the server refuses its reads anyway -
 * requireCompanyViewer in lib/company.ts).
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { readCompanyLink, useCompany } from "@/contexts/company-context";
import { TOURS_HOME, isToursCompanyPath } from "@/lib/nav";
import { COMPANY_UNASSIGNED_NOTICE } from "@/lib/auth/tours-agent";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";
import {
  COMPANY_HOME_HINT_COOKIE,
  COMPANY_HOME_HINT_MAX_AGE,
  type CompanyHomeHint,
} from "@/lib/company-ids";

/** The routing hint of lib/company-ids.ts, as this browser holds it. */
function readHint(): CompanyHomeHint | null {
  try {
    const found = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${COMPANY_HOME_HINT_COOKIE}=`));
    const value = found?.slice(COMPANY_HOME_HINT_COOKIE.length + 1);
    return value === "tours" || value === "events" ? value : null;
  } catch {
    return null;
  }
}

function writeHint(value: CompanyHomeHint) {
  try {
    if (readHint() === value) return;
    document.cookie = `${COMPANY_HOME_HINT_COOKIE}=${value}; path=/; max-age=${COMPANY_HOME_HINT_MAX_AGE}; samesite=lax`;
  } catch {
    // No cookie access: the gate still redirects, just without the hint.
  }
}

export function CompanyRouteGate({ children }: { children: React.ReactNode }) {
  const { active, isLoading, unassigned, isFollowingLink } = useCompany();
  // Until the companies are known, a URL with a company link waits: it may be about to change company.
  const waitsForLink = isFollowingLink || (isLoading && readCompanyLink() !== null);
  const { user } = useAuth();
  // A tours_agent has no default company: nothing is drawn until its own is known.
  const waitsForCompany = isLoading && user?.role === TOURS_AGENT_ROLE;
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [hinted] = useState(() => readHint() === "tours");

  const toursOnly = !!active && !active.productTypes.includes("events");
  const outside = !isToursCompanyPath(pathname);
  const away = toursOnly && outside;

  useEffect(() => {
    // Keeps the hint true to the company the server resolved, so a stale one
    // (a membership that changed) is corrected on the first page that loads.
    // An unassigned tours_agent has no company to hint at.
    if (!isLoading && !unassigned) writeHint(toursOnly ? "tours" : "events");
  }, [isLoading, toursOnly, unassigned]);

  useEffect(() => {
    // Not while a company deep link is being followed: the page is about to
    // load again in the company the link names.
    if (away && !isFollowingLink) router.replace(TOURS_HOME);
  }, [away, isFollowingLink, router]);

  if (unassigned) {
    return (
      <div dir="rtl" className="flex h-[50vh] items-center justify-center" data-testid="company-unassigned">
        <div className="max-w-md rounded-lg border bg-card p-8 text-center">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h1 className="font-display text-xl font-bold">{COMPANY_UNASSIGNED_NOTICE}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            מנהל החברה צריך לשייך את החשבון שלכם לחברה. אחרי השיוך רעננו את הדף ולוח היציאות ייפתח.
          </p>
        </div>
      </div>
    );
  }

  if (away || waitsForCompany || waitsForLink || (isLoading && hinted && outside)) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
