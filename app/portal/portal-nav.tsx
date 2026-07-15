"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "דשבורד", href: "/portal" },
  { name: "הקופונים שלי", href: "/portal/coupons" },
  { name: "ההזמנות שלי", href: "/portal/reservations" },
  { name: "הצעות מחיר", href: "/portal/quotes" },
];

export function PortalNav() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <nav className="flex items-center gap-1">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/portal" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.name}
          </Link>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => logout()}
      >
        <LogOut className="h-4 w-4" />
        התנתק
      </Button>
    </nav>
  );
}
