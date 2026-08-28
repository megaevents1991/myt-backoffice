"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  LockOpen,
  Package,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  deletePreparedPackage,
  getAgentOrderHandoffLink,
  setPackageAllowEdit,
  type PreparedPackageListItem,
} from "@/lib/actions/portal-package-actions";

/**
 * "הזמנה עבור הלקוח" - opens main's order flow THROUGH the partner-handoff
 * endpoint, so the agent arrives with a live session on main's domain and the
 * agent-paid settlement methods (agent card / voucher) actually pass the
 * server's requireAgent gate. The window opens synchronously (popup-blocker
 * safe) and gets its URL once the short-lived token is minted.
 */
function OrderForCustomerButton({ pkg }: { pkg: PreparedPackageListItem }) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const win = window.open("about:blank", "_blank");
    startTransition(async () => {
      const result = await getAgentOrderHandoffLink(pkg.id);
      if (!result.ok) {
        win?.close();
        toast({ title: result.error, variant: "destructive" });
        return;
      }
      if (win) win.location.href = result.url;
      else window.open(result.url, "_blank");
    });
  };

  return (
    <Button type="button" size="sm" variant="outline" onClick={handleClick} disabled={isPending}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
      הזמנה עבור הלקוח
    </Button>
  );
}

/** Lock/unlock an existing package - a mistaken lock is no longer permanent. */
function LockToggleButton({ pkg }: { pkg: PreparedPackageListItem }) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const locked = !pkg.allow_edit;

  const handleToggle = () => {
    startTransition(async () => {
      const result = await setPackageAllowEdit(pkg.id, locked);
      if (!result.ok) {
        toast({ title: result.error, variant: "destructive" });
      } else {
        toast({
          title: locked ? "החבילה נפתחה לעריכה" : "החבילה ננעלה",
          description: locked
            ? "מי שיפתח את הלינק יוכל להחליף כרטיסים, טיסה ומלון."
            : "מי שיפתח את הלינק ישלם על ההרכב שבניתם, בלי לשנות אותו.",
        });
      }
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleToggle}
      disabled={isPending}
      title={locked ? "פתיחת החבילה לעריכת הלקוח" : "נעילת ההרכב בפני שינויים"}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : locked ? (
        <LockOpen className="h-4 w-4" />
      ) : (
        <Lock className="h-4 w-4" />
      )}
      {locked ? "פתיחה לעריכה" : "נעילה"}
    </Button>
  );
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button type="button" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "הועתק" : "העתקת לינק"}
    </Button>
  );
}

function PartBadge({
  mode,
  offlineLabel,
  summary,
}: {
  mode: "offline" | "live" | "none";
  offlineLabel: string;
  summary: string | null;
}) {
  if (mode === "offline") {
    return (
      <Badge variant="secondary" className="max-w-56 truncate font-normal" title={summary ?? undefined}>
        {summary || offlineLabel}
      </Badge>
    );
  }
  if (mode === "live") {
    return <Badge variant="outline" className="font-normal">הלקוח בוחר באתר</Badge>;
  }
  return <Badge variant="outline" className="font-normal text-muted-foreground">ללא</Badge>;
}

export function PackagesList({
  packages,
  isAgent = false,
  isManager = false,
}: {
  packages: PreparedPackageListItem[];
  /** Agents also get "send offer" and "order for the customer" per package. */
  isAgent?: boolean;
  /** Managers get a "נוצר ע"י" column - agents in a multi-user office only
   *  ever see their own packages, so the column would be redundant for them. */
  isManager?: boolean;
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    setDeletingId(id);
    startTransition(async () => {
      const result = await deletePreparedPackage(id);
      setDeletingId(null);
      if (!result.ok) {
        toast({ title: result.error, variant: "destructive" });
      }
    });
  };

  if (packages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Package className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">עדיין אין חבילות</p>
        <p className="mt-1 text-sm text-muted-foreground">
          בנו חבילה ראשונה ושתפו את הלינק עם הקהל שלכם.
        </p>
        <Button
          asChild
          className="mt-4 rounded-full bg-brand-mint px-5 font-semibold text-brand-forest transition-[background-color,box-shadow,transform] duration-200 ease-out hover:bg-brand-mint/90 hover:shadow-mint-glow active:scale-[0.98]"
        >
          <Link href="/portal/packages/new">בניית חבילה</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {packages.map((pkg) => (
        <li
          key={pkg.id}
          className="rounded-2xl border bg-card p-4 shadow-card transition-shadow hover:shadow-card-hover"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{pkg.event_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[
                  pkg.event_date ? new Date(pkg.event_date).toLocaleDateString("he-IL") : null,
                  pkg.location_name || null,
                  `${pkg.qty} × ${pkg.category}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {!pkg.allow_edit && (
                  <Badge className="bg-brand-forest font-normal text-primary-foreground hover:bg-brand-forest">
                    <Lock className="me-1 h-3 w-3" />
                    נעולה לעריכה
                  </Badge>
                )}
                <span className="text-muted-foreground">טיסה:</span>
                <PartBadge mode={pkg.flight} offlineLabel="טיסה מוצמדת" summary={pkg.flight_summary} />
                <span className="ms-2 text-muted-foreground">מלון:</span>
                <PartBadge mode={pkg.hotel} offlineLabel="מלון מוצמד" summary={pkg.hotel_summary} />
                {isManager && (
                  <>
                    <span className="ms-2 text-muted-foreground">{'נוצר ע"י:'}</span>
                    <Badge variant="outline" className="font-normal">
                      {pkg.creator_name ?? "-"}
                    </Badge>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isAgent && (
                <>
                  <Button asChild type="button" size="sm" variant="outline">
                    <Link href={`/portal/quotes/new?package=${pkg.id}`}>
                      <FileText className="h-4 w-4" />
                      שלח הצעה ללקוח
                    </Link>
                  </Button>
                  <OrderForCustomerButton pkg={pkg} />
                </>
              )}
              <LockToggleButton pkg={pkg} />
              <CopyLinkButton link={pkg.link} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={isPending && deletingId === pkg.id}
                  >
                    {isPending && deletingId === pkg.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>למחוק את החבילה?</AlertDialogTitle>
                    <AlertDialogDescription>
                      הלינק יפסיק לעבוד - מי שיפתח אותו יגיע לעמוד ההזמנה הרגיל של
                      האירוע, בלי הרכב שבחרתם.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>ביטול</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(pkg.id)}>
                      מחיקה
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              dir="ltr"
              value={pkg.link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full flex-1 truncate rounded-md border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
