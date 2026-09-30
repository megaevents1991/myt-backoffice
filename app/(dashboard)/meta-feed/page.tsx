import {
  getMetaFeedSnapshots,
  getSyncHealth,
  listFeedPickerEvents,
} from "@/lib/actions/meta-feed-actions";
import { getSession } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/types/auth.types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SyncFeedButton } from "./sync-button";
import { SyncAllButton } from "./sync-all-button";
import { PushEventsPanel } from "./push-events-panel";

/**
 * Meta product feed status + manual sync. The feed itself is built live by the
 * main app; the publishMetaFeed cron copies those bytes to Storage six times a
 * day (every 3h, 05:00-20:00 UTC - vercel.json) and Meta fetches the Storage
 * file hourly. "סנכרן הכל" (/api/admin-sync) is admin-only, so editors don't get it.
 */
export const dynamic = "force-dynamic";

const LABELS: Record<string, { title: string; note: string; primary?: boolean }> = {
  "feeds/meta-activities-feed.csv": {
    title: "Meta - Activities (הפיד הפעיל)",
    note: "זה הקובץ שרשום במטא (Commerce Manager).",
    primary: true,
  },
  "feeds/meta-catalog-feed.csv": {
    title: "E-commerce CSV",
    note: "נשמר עבור Google Merchant. לא בשימוש במטא.",
  },
  "feeds/meta-catalog-feed.xml": {
    title: "E-commerce XML",
    note: "נשמר עבור Google Merchant. לא בשימוש במטא.",
  },
};

function formatAge(
  updatedAt: string | null,
  staleAfterHours = 26,
  neverText = "טרם פורסם",
): { text: string; stale: boolean } {
  if (!updatedAt) return { text: neverText, stale: true };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000);
  // The cron runs at least daily; older than its window means it stopped working.
  const stale = ms > staleAfterHours * 3_600_000;
  if (hours < 1) return { text: `לפני ${minutes} דק׳`, stale };
  if (hours < 48) return { text: `לפני ${hours} שע׳`, stale };
  return { text: `לפני ${Math.floor(hours / 24)} ימים`, stale };
}

export default async function MetaFeedPage() {
  const [snapshots, health, session, pickerEvents] = await Promise.all([
    getMetaFeedSnapshots(),
    getSyncHealth(),
    getSession(),
    listFeedPickerEvents(),
  ]);
  const isAdmin = !!session && ADMIN_ROLES.includes(session.role);
  const staleSyncs = health.rows.filter(
    (row) => formatAge(row.lastRun, row.staleAfterHours).stale,
  );

  return (
    <div className="container mx-auto py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Meta Product Feed</h1>
          <p className="text-muted-foreground mt-1">
            הפיד נבנה חי מהמערכת. הסנכרון מעתיק אותו לקובץ הסטטי שמטא קוראת -
            רץ אוטומטית שש פעמים ביום, כל שלוש שעות בין 05:00 ל־20:00 UTC.
          </p>
        </div>
        <SyncFeedButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>אירועים ספציפיים לפיד</CardTitle>
          <CardDescription>
            תיקנתם אירוע או העליתם אחד חדש ולא רוצים לחכות ל-cron? בוחרים אחד או
            כמה - כל אחד מצויר מחדש (גם אם לא השתנה בו כלום) תחת כתובת תמונה חדשה
            כדי שמטא תמשוך אותה, ואז הקובץ מפורסם פעם אחת.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushEventsPanel events={pickerEvents} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>בריאות הסנכרונים</CardTitle>
          <CardDescription>
            מתי כל סנכרון כתב נתונים בפעם האחרונה. אם כולם אדומים - הקרונים של
            Vercel לא רצים (בדוק ש־<code dir="ltr">CRON_SECRET</code> מוגדר
            בפרויקט), והכפתור &quot;סנכרן הכל&quot; כאן (מנהלים בלבד) מריץ את הכול
            ידנית.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {staleSyncs.length > 0 && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              {staleSyncs.length} סנכרונים לא רצו בזמן - הנתונים בפיד עלולים
              להיות ישנים.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {health.rows.map((row) => {
              const age = formatAge(row.lastRun, row.staleAfterHours, "מעולם לא רץ");
              return (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="text-sm font-medium">{row.label}</span>
                  <Badge variant={age.stale ? "destructive" : "secondary"}>{age.text}</Badge>
                </div>
              );
            })}
          </div>

          <p className="text-sm text-muted-foreground">
            קריאטיבים: {health.eventsWithCreative} מתוך {health.eventsInFeedWindow}{" "}
            אירועים בחלון הפיד. אירוע בלי קריאטיב לא נכנס לפיד, ולכן לא מופיע
            במטא.
          </p>

          {isAdmin ? (
            <SyncAllButton />
          ) : (
            <p className="text-sm text-muted-foreground">
              &quot;סנכרן הכל&quot; (כל ה־API) זמין למנהלים בלבד.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>סטטוס הקבצים</CardTitle>
          <CardDescription>
            מטא מושכת את הקובץ בעצמה כל שעה, כך שאחרי סנכרון ייתכן עיכוב של עד
            שעה עד שהשינוי מופיע בקטלוג.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {snapshots.map((snap) => {
            const meta = LABELS[snap.path] ?? { title: snap.path, note: "" };
            const age = formatAge(snap.updatedAt);
            return (
              <div
                key={snap.path}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{meta.title}</span>
                    {meta.primary && <Badge>פעיל במטא</Badge>}
                    <Badge variant={age.stale ? "destructive" : "secondary"}>
                      {age.text}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.note}</p>
                  <a
                    href={snap.publicUrl}
                    target="_blank"
                    rel="noopener"
                    className="block text-xs text-blue-600 hover:underline break-all"
                    dir="ltr"
                  >
                    {snap.publicUrl}
                  </a>
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {snap.sizeBytes != null
                    ? `${Math.round(snap.sizeBytes / 1024)} KB`
                    : "-"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
