"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Users,
  ClipboardList,
  Home,
  LogOut,
  Settings,
  Database,
  Menu,
  X,
  Plane,
  Trophy,
  MapPin,
  Music,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";

type NavItem =
  | {
      name: string;
      href: string;
      icon: React.ComponentType<{ className?: string }>;
    }
  | { type: "divider" };

const navItems: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { type: "divider" },
  { name: "Events", href: "/events", icon: CalendarDays },
  { name: "Partners", href: "/partners", icon: Users },
  { name: "Reservations", href: "/reservations", icon: ClipboardList },
  { type: "divider" },
  { name: "Offline Flights", href: "/offline-flights", icon: Plane },
  { name: "Sports Events", href: "/sports-events", icon: Trophy },
  { name: "Live Events", href: "/live-events", icon: Music },
  { type: "divider" },
  { name: "Storage", href: "/storage", icon: Database },
  { name: "Locations", href: "/locations", icon: MapPin },
];

export function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle button - visible only on small screens */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-40 md:hidden"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </Button>

      {/* Sidebar */}
      <div
        className={cn(
          "border-r bg-background w-64 fixed inset-y-0 left-0 z-30 transition-transform duration-200 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0 md:static"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b px-6 py-4">
            <h2 className="text-xl font-bold">Backoffice</h2>
          </div>
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item, index) => {
              // Handle dividers
              if ("type" in item && item.type === "divider") {
                return (
                  <div key={`divider-${index}`} className="border-b my-3" />
                );
              }

              // TypeScript now knows this is a link item
              const linkItem = item as {
                name: string;
                href: string;
                icon: React.ComponentType<{ className?: string }>;
              };
              const isActive =
                pathname === linkItem.href ||
                pathname.startsWith(`${linkItem.href}/`);
              const Icon = linkItem.icon;

              return (
                <Link
                  key={linkItem.href}
                  href={linkItem.href}
                  onClick={() => setIsOpen(false)} // Close sidebar when clicking a link on mobile
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {linkItem.name}
                </Link>
              );
            })}
          </nav>
          <div className="border-t p-4">
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => logout()}
            >
              <LogOut className="mr-3 h-5 w-5" />
              Log out
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
