import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Shown when the active company does not sell tours (Mega Events) - the same card the Tours overview shows. */
export function NotAToursCompany() {
  return (
    <div dir="rtl" className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">המסך הזה שייך לחברת טיולים</CardTitle>
          <CardDescription>
            אישורים וטיפול זמינים רק כשהחברה הפעילה מוכרת טיולים. אם יש לך גישה לחברה כזו, אפשר לעבור אליה
            מבורר החברות בסרגל העליון.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">חזרה לדשבורד</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Shown to a staff member of the company who is not its manager. */
export function ManagersOnly() {
  return (
    <div dir="rtl" className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">המסך הזה פתוח למנהל החברה</CardTitle>
          <CardDescription>
            כאן מרוכזים האישורים וההחלטות שרק מנהל החברה נותן. את העבודה השוטפת ממשיכים מלוח היציאות ומקבוצות
            הטיסה.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/tours">חזרה לסקירה</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
