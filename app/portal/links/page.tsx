import { getSession } from "@/lib/auth/guards";
import { getQuoteEvents } from "@/lib/actions/quote-actions";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import { LogoSettings } from "./logo-settings";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkBuilder } from "./link-builder";

export default async function PortalLinksPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  if (!isPartner || !session.partner_code) return null;

  const [events, profile] = await Promise.all([
    getQuoteEvents().catch((error: unknown) => {
      // The general link is the important one and needs no data — never let the
      // event list failing take the whole page down.
      console.error("PortalLinksPage events:", error);
      return [];
    }),
    getPortalProfile().catch((error: unknown) => {
      console.error("PortalLinksPage profile:", error);
      return null;
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>הלינקים שלי</CardTitle>
          <CardDescription>
            כל מי שנכנס דרך הלינקים האלה משויך אליכם — גם אם יזמין מאוחר יותר,
            וגם אם יעבור בינתיים בין עמודים באתר.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkBuilder trackingCode={session.partner_code} events={events} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>הלוגו שלכם</CardTitle>
          <CardDescription>
            מופיע בהצעות המחיר שאתם מפיקים ובראש הפורטל.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoSettings logoUrl={profile?.logo_url ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>איך זה עובד</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            הלינק נושא את קוד המעקב שלכם. ברגע שהלקוח נכנס, הקוד נשמר אצלו בדפדפן —
            הוא יכול לחזור אחר כך, ישירות לאתר, וההזמנה עדיין תיזקף לזכותכם.
          </p>
          <p>
            הלינק לאירוע מסוים מביא את הלקוח ישר לעמוד ההזמנה של אותו אירוע, במקום
            לעמוד הבית. שימושי כששולחים המלצה על אירוע ספציפי.
          </p>
          <p>
            הכניסות והשלבים שהלקוחות עוברים מופיעים בדשבורד שלכם. שימו לב שלינק ישיר
            לאירוע מדלג על עמוד הבית, כך שהוא מתחיל להיספר במשפך רק משלב בחירת
            הכרטיסים — השיוך עצמו עובד מהרגע הראשון.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
