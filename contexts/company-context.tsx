"use client";

/**
 * The active company on the client (see lib/company.ts for the server rules).
 *
 * Loaded once the signed-in user is known. Until then - and whenever the load
 * fails - `active` is null and `productTypes` is Mega Events', so the first
 * paint of the sidebar is the one that existed before companies.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getCompanyContext, setActiveCompany } from "@/lib/actions/company-actions";
import { DEFAULT_PRODUCT_TYPES, TOURS_HOME } from "@/lib/nav";
// Types only - lib/company.ts is server code.
import type { Company, ProductType } from "@/lib/company";

interface CompanyContextValue {
  /** The company this browser works in. null until loaded. */
  active: Company | null;
  /** Every company the user may switch to. One entry (or none) = no switcher. */
  companies: Company[];
  isLoading: boolean;
  /** Product types of the active company - Mega Events' until the context has loaded. */
  productTypes: readonly ProductType[];
  /** Makes `slug` the active company and reloads into its home screen. */
  switchTo: (slug: string) => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue>({
  active: null,
  companies: [],
  isLoading: true,
  productTypes: DEFAULT_PRODUCT_TYPES,
  switchTo: async () => {},
});

interface Loaded {
  /** The user the companies were loaded for - a different user means "not loaded". */
  userId: string;
  active: Company | null;
  companies: Company[];
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getCompanyContext()
      .then((context) => {
        if (!cancelled) setLoaded({ userId, active: context.active, companies: context.companies });
      })
      .catch((error) => {
        // Stay on the Mega Events defaults: no switcher, today's nav.
        console.error("getCompanyContext:", error);
        if (!cancelled) setLoaded({ userId, active: null, companies: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = loaded && loaded.userId === userId ? loaded : null;
  const active = current?.active ?? null;
  const companies = current?.companies;

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
      window.location.assign(target.productTypes.includes("tours") ? TOURS_HOME : "/dashboard");
    },
    [active?.slug, companies, toast],
  );

  const value = useMemo<CompanyContextValue>(
    () => ({
      active,
      companies: companies ?? [],
      isLoading: current === null,
      productTypes: active?.productTypes ?? DEFAULT_PRODUCT_TYPES,
      switchTo,
    }),
    [active, companies, current, switchTo],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  return useContext(CompanyContext);
}
