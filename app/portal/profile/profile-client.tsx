"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  FileText,
  KeyRound,
  Mail,
  Percent,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  changeMyEmail,
  changeMyPassword,
  rebalanceMyCommissionSplit,
  updateMyBankDetails,
  updateMyPhone,
} from "@/lib/actions/portal-profile-actions";
import type { MyProfileDetails } from "@/lib/actions/portal-profile-actions";

type ActionResult = { ok: true } | { ok: false; error: string };

export function ProfileClient({ details }: { details: MyProfileDetails }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [currentPw, setCurrentPw] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [email, setEmail] = useState(details.email);
  const [emailPw, setEmailPw] = useState("");
  const [phone, setPhone] = useState(details.phone ?? "");
  const [bank, setBank] = useState({
    bank_name: details.bank_details?.bank_name ?? "",
    branch: details.bank_details?.branch ?? "",
    account_number: details.bank_details?.account_number ?? "",
    account_holder: details.bank_details?.account_holder ?? "",
  });
  const [split, setSplit] = useState({
    commission: String(details.commission),
    user_discount: String(details.user_discount),
  });

  const run = (action: () => Promise<ActionResult>, successMessage: string) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast({ title: successMessage });
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
      }
    });
  };

  const isPercentUnit = details.commission_type === "percent_of_sale";
  const splitUnit = isPercentUnit ? "%" : "$";
  const splitTotal = details.commission + details.user_discount;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Agreement */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" />
            ההסכם שלי
          </CardTitle>
          <CardDescription>ההסכם שהוזן לחשבון שלכם, להורדה.</CardDescription>
        </CardHeader>
        <CardContent>
          {details.contract_url ? (
            <Button asChild variant="outline">
              <a href={details.contract_url} target="_blank" rel="noopener noreferrer">
                צפייה בהסכם
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              עוד לא הועלה הסכם לחשבון. פנו אלינו אם חסר.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Commission ↔ discount split — influencers only */}
      {details.role === "affiliate" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent className="h-4 w-4 text-muted-foreground" />
              יחס עמלה ↔ הנחה לעוקבים
            </CardTitle>
            <CardDescription>
              הסכום הכולל ({splitTotal}
              {splitUnit}) נשאר קבוע — אתם בוחרים כמה ממנו הופך להנחה לעוקבים.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">העמלה שלי ({splitUnit})</span>
                <Input
                  type="number"
                  min={0}
                  value={split.commission}
                  onChange={(e) =>
                    setSplit((s) => ({ ...s, commission: e.target.value }))
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">הנחה לעוקבים ({splitUnit})</span>
                <Input
                  type="number"
                  min={0}
                  value={split.user_discount}
                  onChange={(e) =>
                    setSplit((s) => ({ ...s, user_discount: e.target.value }))
                  }
                />
              </label>
            </div>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    rebalanceMyCommissionSplit({
                      commission: Number(split.commission),
                      user_discount: Number(split.user_discount),
                    }),
                  "היחס עודכן"
                )
              }
            >
              עדכנו יחס
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            שינוי סיסמה
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="password"
            placeholder="סיסמה נוכחית"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            type="password"
            placeholder="סיסמה חדשה (לפחות 8 תווים)"
            value={nextPw}
            onChange={(e) => setNextPw(e.target.value)}
            autoComplete="new-password"
          />
          <Button
            disabled={isPending || !currentPw || !nextPw}
            onClick={() =>
              run(async () => {
                const result = await changeMyPassword({
                  current: currentPw,
                  next: nextPw,
                });
                if (result.ok) {
                  setCurrentPw("");
                  setNextPw("");
                }
                return result;
              }, "הסיסמה עודכנה")
            }
          >
            עדכנו סיסמה
          </Button>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-muted-foreground" />
            כתובת מייל
          </CardTitle>
          <CardDescription>המייל משמש גם להתחברות וגם לדוחות.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
          />
          <Input
            type="password"
            placeholder="סיסמה נוכחית לאישור"
            value={emailPw}
            onChange={(e) => setEmailPw(e.target.value)}
            autoComplete="current-password"
          />
          <Button
            disabled={isPending || !email || !emailPw || email === details.email}
            onClick={() =>
              run(async () => {
                const result = await changeMyEmail({
                  next: email,
                  currentPassword: emailPw,
                });
                if (result.ok) setEmailPw("");
                return result;
              }, "המייל עודכן — בכניסה הבאה מתחברים איתו")
            }
          >
            עדכנו מייל
          </Button>
        </CardContent>
      </Card>

      {/* Phone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4 text-muted-foreground" />
            טלפון
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="050-0000000"
            dir="ltr"
          />
          <Button
            disabled={isPending}
            onClick={() => run(() => updateMyPhone({ phone }), "הטלפון עודכן")}
          >
            עדכנו טלפון
          </Button>
        </CardContent>
      </Card>

      {/* Bank details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-4 w-4 text-muted-foreground" />
            פרטי בנק לתשלום
          </CardTitle>
          <CardDescription>לאן מעבירים את העמלות שלכם.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="בנק"
              value={bank.bank_name}
              onChange={(e) => setBank((b) => ({ ...b, bank_name: e.target.value }))}
            />
            <Input
              placeholder="סניף"
              value={bank.branch}
              onChange={(e) => setBank((b) => ({ ...b, branch: e.target.value }))}
            />
            <Input
              placeholder="מספר חשבון"
              value={bank.account_number}
              onChange={(e) =>
                setBank((b) => ({ ...b, account_number: e.target.value }))
              }
              dir="ltr"
            />
            <Input
              placeholder="שם בעל החשבון"
              value={bank.account_holder}
              onChange={(e) =>
                setBank((b) => ({ ...b, account_holder: e.target.value }))
              }
            />
          </div>
          <Button
            disabled={isPending}
            onClick={() => run(() => updateMyBankDetails(bank), "פרטי הבנק נשמרו")}
          >
            שמרו פרטי בנק
          </Button>
        </CardContent>
      </Card>

      {/* כרטיס אשראי לתשלום הוסר לבקשת אלון ודור (2026-08-06) — אין תמיכה
          בחיוב כרטיס של סוכן בשלב הזה. הפעולה updateMyPaymentCard נשארת
          בצד השרת להחזרה קלה. */}
    </div>
  );
}
