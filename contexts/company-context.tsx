"use client";

/**
 * The active company on the client (see lib/company.ts for the server rules).
 *
 * Loaded once the signed-in user is known. Until then - and whenever the load
 * fails - `active` is null and `productTypes` is Mega Events', so the first
 * paint of the sidebar is the one that existed before companies.
 *
 * Company deep link: any dashboard URL may carry `company=<slug>`
 * (`/tasks?task=12&company=mega-family`), so a link in a mail opens in the
 * right company for someone who works in more than one. Once the companies
 * are known, a slug that is another company of THIS viewer is made active and
 * the same URL is loaded again; a slug that matches, is unknown or is not the
 * viewer's is ignored. The param grants nothing - setActiveCompany checks the
 * membership on the server.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getCompanyContext, setActiveCompany } from "@/lib/actions/company-actions";
import { DEFAULT_PRODUCT_TYPES, TOURS_HOME } from "@/lib/nav";
import { TOURS_AGENT_HOME } from "@/lib/auth/tours-agent";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";
// Types only - lib/company.ts is server code.
import type { Company, ProductType } from "@/lib/company";

/** The query param of a company deep link. */
export const COMPANY_LINK_PARAM = "company";

/** The company slug the current URL asks for, or null. Null on the server. */
export function readCompanyLink(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(COMPANY_LINK_PARAM)?.trim() || null;
  } catch {
    return null;
  }
}

interface CompanyContextValue {
  /** The company this browser works in. null until loaded. */
  active: Company | null;
  /** Every company the user may switch to. One entry (or none) = no switcher. */
  companies: Company[];
  isLoading: boolean;
  /**
   * The signed-in tours_agent was not assigned to any company yet: it works
   * nowhere, and the route gate shows a notice instead of the page.
   */
  unassigned: boolean;
  /**
   * A company deep link is being followed: the active company is changing and
   * the page is about to load again. The route gate holds the page meanwhile.
   */
  isFollowingLink: boolean;
  /** Product types of the active company - Mega Events' until the context has loaded. */
  productTypes: readonly ProductType[];
  /** Makes `slug` the active company and reloads into its home screen. */
  switchTo: (slug: string) => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue>({
  active: null,
  companies: [],
  isLoading: true,
  unassigned: false,
  isFollowingLink: false,
  productTypes: DEFAULT_PRODUCT_TYPES,
  switchTo: async () => {},
});

interface Loaded {
  /** The user the companies were loaded for - a different user means "not loaded". */
  userId: string;
  active: Company | null;
  companies: Company[];
  unassigned: boolean;
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const userId = user?.id ?? null;
  const isToursAgent = user?.role === TOURS_AGENT_ROLE;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getCompanyContext()
      .then((context) => {
        if (!cancelled) {
          setLoaded({
            userId,
            active: context.active,
            companies: context.companies,
            unassigned: context.unassigned === true,
          });
        }
      })
      .catch((error) => {
        // Stay on the Mega Events defaults: no switcher, today's nav.
        console.error("getCompanyContext:", error);
        if (!cancelled) setLoaded({ userId, active: null, companies: [], unassigned: false });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = loaded && loaded.userId === userId ? loaded : null;
  const active = current?.active ?? null;
  const companies = current?.companies;

  // ---- company deep link (`?company=<slug>`)
  // The pathname is read only so that a navigation renders this again and the new URL is looked at.
  usePathname();
  /** A slug the server refused to switch to - not tried again, the page stays where it is. */
  const [refusedLink, setRefusedLink] = useState<string | null>(null);
  const linked = current ? readCompanyLink() : null;
  // Follow the link only into ANOTHER company of this viewer. Unknown, not the
  // viewer's, or already active: ignored, silently.
  const followLink =
    linked !== null &&
    linked !== active?.slug &&
    linked !== refusedLink &&
    (companies ?? []).some((company) => company.slug === linked)
      ? linked
      : null;
  useEffect(() => {
    if (!followLink) return;
    let cancelled = false;
    setActiveCompany(followLink)
      .then((result) => {
        if (cancelled) return;
        // A full load of the SAME url: every server component renders in the new
        // company, and the param then equals the active company, so nothing repeats.
        if (result.success) window.location.reload();
        else setRefusedLink(followLink);
      })
      .catch((error) => {
        console.error("company deep link:", error);
        if (!cancelled) setRefusedLink(followLink);
      });
    return () => {
      cancelled = true;
    };
  }, [followLink]);
  const isFollowingLink = followLink !== null;

  const switchTo = useCallback(
    async (slug: string) => {
      const target = companies?.find((company) => company.slug === slug);
      if (!target || target.slug === active?.slug) return;
      let error: string | undefined;
      try {
        const result = await setActiveCompany(slug);
        if (!result.success) error = result.error ?? "החלפת החברה נכשלה";
      } catch (e) {
        console.error("setActiveCompany:", e);
        error = "החלפת החברה נכשלה";
      }
      if (error) {
        toast({ variant: "destructive", title: "החלפת חברה", description: error });
        return;
      }
      // A full load, not router.push: every server component must render again in the new company.
      window.location.assign(
        isToursAgent ? TOURS_AGENT_HOME : target.productTypes.includes("tours") ? TOURS_HOME : "/dashboard",
      );
    },
    [active?.slug, companies, isToursAgent, toast],
  );

  const value = useMemo<CompanyContextValue>(
    () => ({
      active,
      companies: companies ?? [],
      isLoading: current === null,
      unassigned: current?.unassigned ?? false,
      isFollowingLink,
      productTypes: active?.productTypes ?? DEFAULT_PRODUCT_TYPES,
      switchTo,
    }),
    [active, companies, current, isFollowingLink, switchTo],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  return useContext(CompanyContext);
}
