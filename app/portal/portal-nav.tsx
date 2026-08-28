"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  name: string;
  href: string;
  roles?: string[];
  creditGated?: boolean;
  /** Extra path prefixes that light this item up as active (V2: the hub
   *  tabs צבירה/קופונים live on their own routes but belong to
   *  "מידע ועדכונים"; packages belong to the dashboard's search). */
  alsoActiveOn?: string[];
};

/**
 * V2 menu (2026-08-27 spec): דשבורד | הצעות מחיר | ההזמנות שלי |
 * מידע ועדכונים | הפרופיל שלי (+ הצוות שלי for office managers).
 * חבילות/צבירה/קופונים left the bar - the dashboard's search engine covers
 * links/packages, and credit/coupons became tabs of the מידע ועדכונים hub.
 */
const navItems: NavItem[] = [
  { name: "דשבורד", href: "/portal", alsoActiveOn: ["/portal/packages"] },
  // Sellers only - an influencer promotes a link and never prices a package
  // for a named customer. The server action enforces it too.
  { name: "הצעות מחיר", href: "/portal/quotes", roles: ["agent", "office_manager"] },
  { name: "ההזמנות שלי", href: "/portal/reservations" },
  {
    name: "מידע ועדכונים",
    href: "/portal/activity",
    alsoActiveOn: ["/portal/credit", "/portal/coupons"],
  },
  { name: "הצוות שלי", href: "/portal/team", roles: ["office_manager"] },
  { name: "הפרופיל שלי", href: "/portal/profile" },
];

export function PortalNav({
  role,
  showCredit,
}: {
  role?: string | null;
  showCredit?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Role comes from the LAYOUT's server session, not the client auth context:
  // the portal session lives in a /portal-scoped cookie the context's
  // /api/auth/session endpoint never receives (multi-session - a staff
  // session may be signed in beside it), so the context would report the
  // wrong identity here.

  const handleLogout = async () => {
    try {
      // scope: "portal" ends ONLY the portal session - a staff `session`
      // signed in beside it in the same browser survives.
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "portal" }),
      });
    } catch {
      // Network hiccup - still leave the page; the cookie dies on its own.
    }
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {navItems
        .filter((item) => !item.roles || (role != null && item.roles.includes(role)))
        .filter((item) => !item.creditGated || showCredit)
        .map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/portal" && pathname.startsWith(`${item.href}/`)) ||
          (item.alsoActiveOn ?? []).some(
            (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
          );

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-brand-mint text-brand-forest"
                : "text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground"
            )}
          >
            {item.name}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={handleLogout}
        className="ms-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-primary-foreground/70 transition-colors hover:bg-white/10 hover:text-primary-foreground"
      >
        <LogOut className="h-4 w-4" />
        התנתק
      </button>
    </nav>
  );
}
