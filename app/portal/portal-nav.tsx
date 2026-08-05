"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { name: string; href: string; agentOnly?: boolean };

const navItems: NavItem[] = [
  { name: "דשבורד", href: "/portal" },
  { name: "החבילות והלינקים שלי", href: "/portal/packages" },
  { name: "הצבירה שלי", href: "/portal/credit" },
  { name: "הקופונים שלי", href: "/portal/coupons" },
  { name: "ההזמנות שלי", href: "/portal/reservations" },
  // Agents only — an influencer promotes a link and never prices a package
  // for a named customer. The server action enforces it too.
  { name: "הצעות מחיר", href: "/portal/quotes", agentOnly: true },
  { name: "עדכונים", href: "/portal/activity" },
];

export function PortalNav({ role }: { role?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  // Role comes from the LAYOUT's server session, not the client auth context:
  // the portal session lives in a /portal-scoped cookie the context's
  // /api/auth/session endpoint never receives (multi-session — a staff
  // session may be signed in beside it), so the context would report the
  // wrong identity here.
  const isAgent = role === "agent";

  const handleLogout = async () => {
    try {
      // scope: "portal" ends ONLY the portal session — a staff `session`
      // signed in beside it in the same browser survives.
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "portal" }),
      });
    } catch {
      // Network hiccup — still leave the page; the cookie dies on its own.
    }
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {navItems
        .filter((item) => !item.agentOnly || isAgent)
        .map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/portal" && pathname.startsWith(`${item.href}/`));

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
