"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

type NavItem = { name: string; href: string; agentOnly?: boolean };

const navItems: NavItem[] = [
  { name: "דשבורד", href: "/portal" },
  { name: "החבילות שלי", href: "/portal/packages" },
  { name: "הלינקים שלי", href: "/portal/links" },
  { name: "הצבירה שלי", href: "/portal/credit" },
  { name: "הקופונים שלי", href: "/portal/coupons" },
  { name: "ההזמנות שלי", href: "/portal/reservations" },
  // Agents only — an influencer promotes a link and never prices a package
  // for a named customer. The server action enforces it too.
  { name: "הצעות מחיר", href: "/portal/quotes", agentOnly: true },
];

export function PortalNav() {
  const pathname = usePathname();
  const { logout, user } = useAuth();
  const isAgent = user?.role === "agent";

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
        onClick={() => logout()}
        className="ms-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-primary-foreground/70 transition-colors hover:bg-white/10 hover:text-primary-foreground"
      >
        <LogOut className="h-4 w-4" />
        התנתק
      </button>
    </nav>
  );
}
