import { getSession } from "@/lib/auth/guards";
import { getPortalCoupons } from "@/lib/actions/portal-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDiscountType(discountType: string): string {
  return discountType === "percent" ? "אחוז" : "סכום קבוע";
}

function formatDiscountValue(discountType: string, value: number): string {
  return discountType === "percent" ? `${value}%` : `$${value}`;
}

function formatUsage(timesUsed: number | null, maxUses: number | null): string {
  return `${timesUsed ?? 0}/${maxUses ?? "∞"}`;
}

export default async function PortalCouponsPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (getPortalCoupons throws for non-agent/affiliate roles).
  if (!isPartner) return null;

  const coupons = await getPortalCoupons();

  if (coupons.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        אין קופונים עדיין
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>קוד</TableHead>
            <TableHead>סוג הנחה</TableHead>
            <TableHead>ערך</TableHead>
            <TableHead>בשימוש</TableHead>
            <TableHead>שולמו</TableHead>
            <TableHead>בתוקף עד</TableHead>
            <TableHead>פעיל</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {coupons.map((coupon) => (
            <TableRow key={coupon.id}>
              <TableCell className="font-medium">{coupon.code}</TableCell>
              <TableCell>{formatDiscountType(coupon.discount_type)}</TableCell>
              <TableCell>
                {formatDiscountValue(coupon.discount_type, coupon.discount_value)}
              </TableCell>
              <TableCell>{formatUsage(coupon.times_used, coupon.max_uses)}</TableCell>
              <TableCell>{coupon.times_paid ?? 0}</TableCell>
              <TableCell>
                {coupon.valid_until
                  ? new Date(coupon.valid_until).toLocaleDateString("he-IL")
                  : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={coupon.is_active ? "default" : "outline"}>
                  {coupon.is_active ? "פעיל" : "לא פעיל"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
