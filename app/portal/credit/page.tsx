import { getSession } from "@/lib/auth/guards";
import {
  getMyCredit,
  getMyVoucherSettlement,
} from "@/lib/actions/partner-credit-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  // Staff opening the portal to debug see the layout notice only - getMyCredit
  // throws for any non-partner role.
  if (!isPartner) return null;

  const isAgent = session.role === "agent";
  const [credit, settlement] = await Promise.all([
    getMyCredit(),
    // Voucher settlement is an agent-only flow; the action returns empty for
    // influencers anyway - skip the call entirely for them.
    isAgent ? getMyVoucherSettlement() : Promise.resolve(null),
  ]);

  const hasSettlement =
    !!settlement &&
    settlement.dueSoonCount + settlement.overdueCount + settlement.settledCount > 0;

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
              <p className="font-display text-4xl font-bold tabular-nums">
                {usd.format(credit.balanceUsd)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                נצבר {usd.format(credit.accruedUsd)} על {credit.paidTickets} כרטיסים ·
                מומש {usd.format(credit.redeemedUsd)}
                {credit.returnedUsd > 0 && (
                  <> · חזר לצבירה {usd.format(credit.returnedUsd)}</>
                )}
              </p>
              {credit.deficitUsd > 0 && (
                <p className="mt-2 max-w-md rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  הומרו {usd.format(credit.redeemedUsd)} - יותר ממה שצבור היום,
                  כי הזמנות ששולמו בעבר בוטלו אחרי ההמרה. צבירה חדשה מכסה קודם
                  את הפער של {usd.format(credit.deficitUsd)}, ורק אחריו היתרה
                  תתחיל לעלות.
                </p>
              )}
            </div>
            <ConvertCredit balanceUsd={credit.balanceUsd} />
          </div>
        </CardContent>
      </Card>

      {hasSettlement && settlement && (
        <Card>
          <CardHeader>
            <CardTitle>התחשבנות שוברים מולנו</CardTitle>
            <CardDescription>
              הזמנות ששולמו בשובר: מה ממתין לגבייה, מה עבר את מועד הגבייה (30
              יום) ומה כבר נפרע.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">לגבייה קרובה</p>
                <p className="font-display text-2xl font-bold tabular-nums">
                  {usd.format(settlement.dueSoonUsd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {settlement.dueSoonCount} שוברים בתוך חלון הגבייה
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">עבר מועד הגבייה</p>
                <p
                  className={`font-display text-2xl font-bold tabular-nums ${
                    settlement.overdueCount > 0 ? "text-destructive" : ""
                  }`}
                >
                  {usd.format(settlement.overdueUsd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {settlement.overdueCount} שוברים מעל 30 יום - טרם שולמו
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">נפרעו</p>
                <p className="font-display text-2xl font-bold tabular-nums">
                  {usd.format(settlement.settledUsd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {settlement.settledCount} שוברים שנגבו ושולמו
                </p>
              </div>
            </div>

            {settlement.openRows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>הזמנה</TableHead>
                    <TableHead>תאריך</TableHead>
                    <TableHead>סכום</TableHead>
                    <TableHead>ותק</TableHead>
                    <TableHead>מצב</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlement.openRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.id}</TableCell>
                      <TableCell>
                        {new Date(row.created_at).toLocaleDateString("he-IL")}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {usd.format(row.amount_usd)}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.age_days} ימים</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {row.age_days > 30 ? (
                            <Badge variant="destructive">עבר מועד</Badge>
                          ) : (
                            <Badge variant="outline">בהמתנה לגבייה</Badge>
                          )}
                          {row.voucher_state && (
                            <Badge variant="secondary" className="whitespace-nowrap">
                              {row.voucher_state === "sent"
                                ? "שובר נשלח"
                                : row.voucher_state === "received"
                                  ? "שובר נקלט"
                                  : "שובר נגבה"}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>הקופונים שיצרתם מהצבירה</CardTitle>
          <CardDescription>
            אם קופון נוצל רק בחלקו, ההפרש חוזר אוטומטית ליתרה שלכם.
          </CardDescription>
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
                  <TableHead>שווי</TableHead>
                  <TableHead>סטטוס</TableHead>
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
                    <TableCell className="text-muted-foreground">
                      {row.outstanding
                        ? "זמין לשימוש"
                        : row.returned_usd > 0
                          ? `נוצל ${usd.format(row.used_usd)} · ${usd.format(row.returned_usd)} חזרו לצבירה`
                          : `נוצל במלואו`}
                    </TableCell>
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
