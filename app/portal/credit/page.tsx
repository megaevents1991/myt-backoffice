import { getSession } from "@/lib/auth/guards";
import { getMyCredit } from "@/lib/actions/partner-credit-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConvertCredit } from "./convert-credit";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export default async function PortalCreditPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Staff opening the portal to debug see the layout notice only — getMyCredit
  // throws for any non-partner role.
  if (!isPartner) return null;

  const credit = await getMyCredit();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>הצבירה שלי</CardTitle>
          <CardDescription>
            {credit.creditPerTicket > 0
              ? `צוברים ${usd.format(credit.creditPerTicket)} על כל כרטיס בהזמנה ששולמה.`
              : "אין הסכם צבירה פעיל בחשבון הזה."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">יתרה להמרה</p>
              <p className="text-4xl font-bold">{usd.format(credit.balanceUsd)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                נצבר {usd.format(credit.accruedUsd)} על {credit.paidTickets} כרטיסים ·
                מומש {usd.format(credit.redeemedUsd)}
              </p>
            </div>
            <ConvertCredit balanceUsd={credit.balanceUsd} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>המרות קודמות</CardTitle>
          <CardDescription>כל המרה מפיקה קופון חד-פעמי ומאפסת את הצבירה.</CardDescription>
        </CardHeader>
        <CardContent>
          {credit.history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              עדיין לא המרתם צבירה לקופון.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>תאריך</TableHead>
                  <TableHead>קוד קופון</TableHead>
                  <TableHead>סכום</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credit.history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {new Date(row.created_at).toLocaleDateString("he-IL")}
                    </TableCell>
                    <TableCell className="font-mono">{row.coupon_code}</TableCell>
                    <TableCell>{usd.format(Number(row.amount_usd))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
