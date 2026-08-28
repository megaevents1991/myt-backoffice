import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * V2 "מידע ועדכונים" tab bar (2026-08-27 spec): one hub page whose tabs
 * gather everything that used to crowd the dashboard and the nav - updates
 * feed, user log, settlement, demand, credit and coupons. Credit and coupons
 * keep their own routes (their pages render this bar too, so they read as
 * tabs of the same hub).
 */

export type InfoTabKey =
  | "updates"
  | "users"
  | "settlement"
  | "demand"
  | "credit"
  | "coupons";

export function InfoTabs({
  active,
  showCredit,
}: {
  active: InfoTabKey;
  showCredit: boolean;
}) {
  const tabs: { key: InfoTabKey; label: string; href: string }[] = [
    { key: "updates", label: "עדכונים", href: "/portal/activity" },
    { key: "users", label: "לוג משתמשים", href: "/portal/activity?tab=users" },
    {
      key: "settlement",
      label: "התחשבנות",
      href: "/portal/activity?tab=settlement",
    },
    { key: "demand", label: "ביקושים", href: "/portal/activity?tab=demand" },
    ...(showCredit
      ? [{ key: "credit" as const, label: "הצבירה שלי", href: "/portal/credit" }]
      : []),
    { key: "coupons", label: "הקופונים שלי", href: "/portal/coupons" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            tab.key === active
              ? "border-transparent bg-brand-mint font-semibold text-brand-forest"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
