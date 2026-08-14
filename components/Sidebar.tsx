"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Home,
  LogOut,
  Database,
  Menu,
  X,
  Plane,
  Trophy,
  MapPin,
  Ticket,
  TicketCheck,
  Tags,
  Hotel,
  LayoutTemplate,
  Percent,
  Image as ImageIcon,
  Images,
  ScrollText,
  Handshake,
  UserCog,
  FolderTree,
  Tag,
  Rss,
  ClipboardCheck,
  ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { switchToMyPartnerPortal } from "@/lib/actions/impersonate-actions";

interface NavLink {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label?: string;
  adminOnly?: boolean;
  items: NavLink[];
}

const navGroups: NavGroup[] = [
  {
    items: [{ name: "Dashboard", href: "/dashboard", icon: Home }],
  },
  {
    label: "Operations",
    items: [
      { name: "Events", href: "/events", icon: CalendarDays },
      { name: "Reservations", href: "/reservations", icon: ClipboardList },
      { name: "Coupons", href: "/coupons", icon: Percent },
      { name: "Partners", href: "/partners", icon: Handshake },
      { name: "Forms (טפסים)", href: "/forms", icon: ClipboardCheck },
    ],
  },
  {
    label: "Mega Inventory",
    items: [
      { name: "Offline Flights", href: "/offline-flights", icon: Plane },
      { name: "Offline Hotels", href: "/offline-hotels", icon: Hotel },
    ],
  },
  {
    label: "Provider Feeds",
    items: [
      { name: "Sports Events (XS2E)", href: "/sports-events", icon: Trophy },
      { name: "Live Events (LiveTickets)", href: "/live-events", icon: Ticket },
      { name: "P1 Events (P1 Tickets)", href: "/p1-events", icon: TicketCheck },
      { name: "TixStock Events", href: "/tixstock-events", icon: Tags },
    ],
  },
  {
    label: "Content",
    items: [
      { name: "Templates (תבניות)", href: "/templates", icon: LayoutTemplate },
      // Categories live under Templates now - one screen builds the page,
      // picks the tags that fill it and places it in the tree.
      { name: "Categories (קטגוריות)", href: "/templates/categories", icon: FolderTree },
      // Tags + auto-tag rules share one screen (banner tabs) - /tag-rules
      // redirects to the rules tab.
      { name: "Tags & Rules (תגיות)", href: "/event-tags", icon: Tag },
      {
        name: "Creative Generator",
        href: "/creative-generator",
        icon: ImageIcon,
      },
      { name: "Meta Product Feed", href: "/meta-feed", icon: Rss },
      { name: "Assets", href: "/assets", icon: Images },
      { name: "Storage", href: "/storage", icon: Database },
      { name: "Locations", href: "/locations", icon: MapPin },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { name: "Users", href: "/users", icon: UserCog },
      { name: "Audit Log", href: "/audit-log", icon: ScrollText },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const visibleGroups = navGroups.filter((group) => !group.adminOnly || isAdmin);

  // Only the MOST SPECIFIC matching item lights up. A plain prefix test marks
  // every ancestor active too, so on /templates/categories both "Templates"
  // and "Categories" looked selected - which reads as a stuck button.
  const activeHref = visibleGroups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

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
          <nav className="flex-1 overflow-y-auto p-4">
            {visibleGroups.map((group, groupIndex) => (
              <div
                key={group.label ?? `group-${groupIndex}`}
                className={cn(groupIndex > 0 && "mt-5")}
              >
                {group.label && (
                  <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                  </p>
                )}
                {group.items.map((item) => {
                  const isActive = item.href === activeHref;
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsOpen(false)} // Close sidebar when clicking a link on mobile
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium mb-1",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="border-t p-4">
            {user && (
              <div className="mb-2 px-3">
                <p className="truncate text-sm font-medium">
                  {user.display_name || user.email}
                </p>
                <p className="text-xs capitalize text-muted-foreground">
                  {user.role}
                </p>
              </div>
            )}
            {/* Dual-role: a staff user linked to a partner code opens /portal
                as that partner in a new tab - the dashboard session stays. */}
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={async () => {
                const result = await switchToMyPartnerPortal();
                if (result.ok) {
                  window.open("/portal", "_blank");
                } else {
                  toast({
                    variant: "destructive",
                    title: "מצב סוכן",
                    description: result.error,
                  });
                }
              }}
            >
              <ArrowLeftRight className="mr-3 h-5 w-5" />
              מצב סוכן
            </Button>
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
