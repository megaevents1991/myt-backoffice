"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, ChevronRight, LogOut, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  activeHref,
  flattenNav,
  visibleGroups,
  type NavGroup,
  type NavItem,
} from "@/lib/nav";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { switchToMyPartnerPortal } from "@/lib/actions/impersonate-actions";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The dashboard navigation. Grouped by the structure spec's areas (see
 * `lib/nav.ts`), collapsible, with the provider feeds nested under Products so
 * the daily flow is not buried under 23 flat links.
 */
export function AppSidebar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { isMobile, setOpenMobile } = useSidebar();

  const groups = visibleGroups(user?.role);
  const active = activeHref(pathname, groups);
  const isFormsOperator = user?.role === "forms_operator";
  const displayName = user?.display_name || user?.email || "";

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;

    if (item.items?.length) {
      // A parent is "active" only through its children, so the group opens on
      // the screen you are actually looking at.
      const childActive = item.items.some((child) => child.href === active);
      return (
        <SubMenu
          key={item.name}
          item={item}
          childActive={childActive}
          active={active}
          onNavigate={closeOnMobile}
        />
      );
    }

    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={item.href === active} tooltip={item.name}>
          <Link href={item.href} onClick={closeOnMobile}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.name}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2 px-2 pt-1">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-mint font-display text-sm font-bold text-brand-forest">
            M
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate font-display text-sm font-bold leading-tight text-sidebar-accent-foreground">
              MYT Admin
            </div>
            <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
              Backoffice
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenSearch}
          className={cn(
            "mx-2 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2 py-1.5 text-xs text-sidebar-foreground/70",
            "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            "group-data-[collapsible=icon]:hidden",
          )}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Go to page…</span>
          <kbd className="ml-auto rounded bg-sidebar-border px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <NavGroupSection
            key={group.label}
            group={group}
            active={active}
            renderItem={renderItem}
            onNavigate={closeOnMobile}
          />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={displayName}
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-mint/30 bg-sidebar-primary font-display text-[11px] font-bold text-brand-mint">
                    {initials(displayName) || "?"}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-xs font-semibold text-sidebar-accent-foreground">
                      {displayName}
                    </span>
                    <span className="block truncate text-[10px] capitalize text-sidebar-foreground/60">
                      {user?.role}
                    </span>
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {/* Dual-role: a staff user linked to a partner code opens /portal
                    as that partner in a new tab - the dashboard session stays.
                    Not for forms operators - they have no partner identity. */}
                {!isFormsOperator && (
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={async () => {
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
                    <ArrowLeftRight className="h-4 w-4" />
                    מצב סוכן
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2" onSelect={() => logout()}>
                  <LogOut className="h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}


const GROUPS_STORAGE_KEY = "myt-nav-open-groups";

/**
 * One collapsible category. Every group folds now, not just the sub-menus, so
 * a 20-item sidebar can be reduced to six headings. While a group is folded,
 * hovering its heading previews what is inside - you can jump straight to a
 * screen without unfolding, which is the whole point of folding it.
 */
function NavGroupSection({
  group,
  active,
  renderItem,
  onNavigate,
}: {
  group: NavGroup;
  active: string | undefined;
  renderItem: (item: NavItem) => React.ReactNode;
  onNavigate: () => void;
}) {
  const { state, isMobile } = useSidebar();
  // In icon mode shadcn hides group labels entirely and each item carries its
  // own tooltip, so the fold/preview pair only applies to the expanded rail.
  const iconMode = state === "collapsed" && !isMobile;

  const holdsActive = flattenNav([group]).some((item) => item.href === active);
  const [open, setOpen] = useState(!group.defaultCollapsed);

  // Restore the fold state after mount - reading storage during render would
  // disagree with the server-rendered markup.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GROUPS_STORAGE_KEY);
      if (!saved) return;
      const map = JSON.parse(saved) as Record<string, boolean>;
      if (typeof map[group.label] === "boolean") setOpen(map[group.label]);
    } catch {
      // Private mode / blocked storage: the default fold state is fine.
    }
  }, [group.label]);

  const persist = (next: boolean) => {
    setOpen(next);
    try {
      const saved = window.localStorage.getItem(GROUPS_STORAGE_KEY);
      const map = saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
      map[group.label] = next;
      window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Not worth failing a click over.
    }
  };

  // Landing on a screen unfolds the group holding it - but only as a nudge:
  // the dep is the flip itself, so folding it back afterwards sticks.
  useEffect(() => {
    if (holdsActive) setOpen(true);
  }, [holdsActive]);

  const isOpen = open || iconMode;
  const showPreview = !isOpen && !iconMode;

  const heading = (
    <SidebarGroupLabel
      asChild
      className="cursor-pointer hover:text-sidebar-accent-foreground"
    >
      <button type="button" onClick={() => persist(!isOpen)}>
        {group.label}
        {!isOpen && (
          <span className="ml-1.5 rounded-full bg-sidebar-accent px-1.5 text-[10px] tabular-nums">
            {group.items.length}
          </span>
        )}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 transition-transform duration-200 ease-out",
            isOpen && "rotate-90",
          )}
        />
      </button>
    </SidebarGroupLabel>
  );

  return (
    <SidebarGroup>
      {showPreview ? (
        <HoverCard openDelay={120} closeDelay={80}>
          <HoverCardTrigger asChild>{heading}</HoverCardTrigger>
          <HoverCardContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-56 p-1.5"
          >
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            {flattenNav([group])
              // A parent that only exists to hold children is not a stop.
              .filter((item) => !item.items?.length)
              .map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      item.href === active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.name}</span>
                  </Link>
                );
              })}
          </HoverCardContent>
        </HoverCard>
      ) : (
        heading
      )}

      {isOpen && (
        <SidebarGroupContent>
          <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}
function SubMenu({
  item,
  childActive,
  active,
  onNavigate,
}: {
  item: NavItem;
  childActive: boolean;
  active: string | undefined;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(childActive);
  const Icon = item.icon;

  return (
    <Collapsible
      asChild
      open={open || childActive}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.name} isActive={childActive}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.name}</span>
            <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform duration-200 ease-out group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items?.map((child) => (
              <SidebarMenuSubItem key={child.href}>
                <SidebarMenuSubButton asChild isActive={child.href === active}>
                  <Link href={child.href} onClick={onNavigate}>
                    <span className="truncate">{child.name}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
