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
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCompany } from "@/contexts/company-context";
import { TOURS_HOME, isToursCompanyPath } from "@/lib/nav";
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
  const { active, isLoading } = useCompany();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [hinted] = useState(() => readHint() === "tours");

  const toursOnly = !!active && !active.productTypes.includes("events");
  const outside = !isToursCompanyPath(pathname);
  const away = toursOnly && outside;

  useEffect(() => {
    // Keeps the hint true to the company the server resolved, so a stale one
    // (a membership that changed) is corrected on the first page that loads.
    if (!isLoading) writeHint(toursOnly ? "tours" : "events");
  }, [isLoading, toursOnly]);

  useEffect(() => {
    if (away) router.replace(TOURS_HOME);
  }, [away, router]);

  if (away || (isLoading && hinted && outside)) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
