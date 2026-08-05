import { getSession } from "@/lib/auth/guards";
import { getPortalActivityFeed } from "@/lib/actions/portal-activity-actions";
import type { PortalActivityType } from "@/lib/actions/portal-activity-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  Link2,
  type LucideIcon,
} from "lucide-react";

/** The עדכונים tab — a derived feed of what happened around this partner:
 *  quote created, package link created, order entered, order paid. */

const TYPE_META: Record<
  PortalActivityType,
  { icon: LucideIcon; badgeClass: string }
> = {
  quote_created: { icon: FileText, badgeClass: "bg-secondary/25 text-primary" },
  package_created: { icon: Link2, badgeClass: "bg-secondary/25 text-primary" },
  order_created: { icon: ClipboardList, badgeClass: "bg-muted text-muted-foreground" },
  order_paid: { icon: CheckCircle2, badgeClass: "bg-brand-mint/30 text-primary" },
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default async function PortalActivityPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Staff visiting /portal see the layout's notice only.
  if (!isPartner) return null;

  const feed = await getPortalActivityFeed();

  return (
    <Card>
      <CardHeader>
        <CardTitle>עדכונים ופעילות</CardTitle>
        <CardDescription>
          מה קרה סביב החשבון שלכם: הצעות מחיר, לינקים לחבילות, הזמנות שנכנסו
          והזמנות ששולמו.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {feed.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            אין עדיין פעילות להצגה.
          </p>
        ) : (
          <ul className="space-y-1">
            {feed.map((item, index) => {
              const meta = TYPE_META[item.type];
              const Icon = meta.icon;
              return (
                <li
                  key={`${item.type}-${item.at}-${index}`}
                  className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                >
                  <span className={`rounded-lg p-1.5 ${meta.badgeClass}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    {item.subtitle && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                  <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(item.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
