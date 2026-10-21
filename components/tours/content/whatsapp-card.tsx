"use client";

/**
 * The WhatsApp card on Settings (spec 2026-10-21 section 8). Not connected: what the admin must know before the
 * coexistence signup (the app version, broadcast lists, linked computers, the history choice) and the button that
 * runs Meta's Embedded Signup - Meta's JS SDK is loaded on demand, every signup event is logged to the console and
 * kept on screen (Meta's "session logging"), and the code plus the two ids go to finishWhatsappSignup. Connected:
 * the number, its mode and quality, the history state, the sending-token hint, the template cache with a sync
 * button, and a test send to the admin's own phone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtInstant } from "@/lib/tours/format";
import { Notice, Section } from "@/components/tours/ui";
import { finishWhatsappSignup, sendWhatsappTest, syncWhatsappTemplates, type WhatsappSettings } from "@/lib/actions/whatsapp-settings-actions";

const GRAPH_VERSION = "v26.0";
const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SDK_ID = "facebook-jssdk";

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FbSdk = {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (response: FbLoginResponse) => void, opts: Record<string, unknown>): void;
};
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

/** Meta's JS SDK, loaded once; resolves with the initialised FB object. */
function loadFbSdk(appId: string): Promise<FbSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error("Facebook SDK did not initialise"));
        return;
      }
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB);
    };
    if (document.getElementById(SDK_ID)) return;
    const script = document.createElement("script");
    script.id = SDK_ID;
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("Facebook SDK could not be loaded"));
    document.body.appendChild(script);
  });
}

type SignupEvent = { at: string; event: string; detail: string };

const MODE_LABELS: Record<string, string> = { coexistence: "משותף עם אפליקציית WhatsApp Business", api_only: "API בלבד" };

export function WhatsappCard({ initial }: { initial: WhatsappSettings }) {
  const run = useActionToast();
  const [settings, setSettings] = useState(initial);
  const [sharedHistory, setSharedHistory] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTemplate, setTestTemplate] = useState("");
  const [events, setEvents] = useState<SignupEvent[]>([]);
  const ids = useRef<{ phoneNumberId: string | null; wabaId: string | null }>({ phoneNumberId: null, wabaId: null });

  const log = useCallback((event: string, detail: string) => {
    console.info(`[whatsapp signup] ${event}: ${detail}`);
    setEvents((list) => [...list, { at: new Date().toISOString(), event, detail }]);
  }, []);

  // Meta posts the signup's progress to the opener window; only facebook.com origins are listened to
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!/\.facebook\.com$/.test(event.origin) && event.origin !== "https://www.facebook.com") return;
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string; current_step?: string; error_message?: string } };
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH") {
          ids.current = { phoneNumberId: data.data?.phone_number_id ?? null, wabaId: data.data?.waba_id ?? null };
          log("FINISH", `phone_number_id=${ids.current.phoneNumberId ?? "?"} waba_id=${ids.current.wabaId ?? "?"}`);
        } else if (data.event === "CANCEL") log("CANCEL", `at step ${data.data?.current_step ?? "?"}`);
        else if (data.event === "ERROR") log("ERROR", data.data?.error_message ?? "unknown");
        else log(data.event ?? "?", JSON.stringify(data.data ?? {}));
      } catch {
        // not Meta's message
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [log]);

  const connect = async () => {
    const signup = settings.signup;
    if (!signup) return;
    setConnecting(true);
    ids.current = { phoneNumberId: null, wabaId: null };
    try {
      const fb = await loadFbSdk(signup.appId);
      log("START", "opening the Facebook signup");
      fb.login(
        (response) => {
          void (async () => {
            const code = response.authResponse?.code ?? null;
            if (!code) {
              log("NO_CODE", response.status ?? "the login returned no code");
              setConnecting(false);
              return;
            }
            const { phoneNumberId, wabaId } = ids.current;
            if (!phoneNumberId || !wabaId) {
              log("NO_IDS", "the signup finished without a phone_number_id / waba_id");
              setConnecting(false);
              return;
            }
            const answer = await run(() => finishWhatsappSignup({ code, phoneNumberId, wabaId, sharedHistory }), "WhatsApp connected");
            if (answer.success && answer.data) setSettings((s) => ({ ...s, account: answer.data ?? s.account }));
            setConnecting(false);
          })();
        },
        {
          config_id: signup.configId,
          response_type: "code",
          override_default_response_type: true,
          // coexistence: the number stays in the WhatsApp Business app - without this feature the popup runs the
          // new-number flow, which refuses a number that lives in the app
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        },
      );
    } catch (e) {
      log("SDK", e instanceof Error ? e.message : String(e));
      setConnecting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    const answer = await run(() => syncWhatsappTemplates(), (a) => `${a.data?.length ?? 0} templates`);
    setSyncing(false);
    if (answer.success && answer.data) setSettings((s) => ({ ...s, templates: answer.data ?? s.templates }));
  };

  const test = async () => {
    if (!settings.staffPhone || !testTemplate) return;
    setTesting(true);
    await run(() => sendWhatsappTest({ to: settings.staffPhone ?? "", template: testTemplate }), "Sent - check your phone");
    setTesting(false);
  };

  const account = settings.account;
  const approved = settings.templates.filter((t) => t.status === "APPROVED");

  return (
    <Section icon={MessageCircle} title="WhatsApp" description="The company's number on the Cloud API - the webhook brings every conversation into the cards.">
      {!account ? (
        <div className="space-y-4" dir="rtl">
          <Notice tone="info">
            <ul className="list-disc space-y-1 ps-5 text-sm">
              <li>המספר נשאר באפליקציית WhatsApp Business בטלפון (גרסה 2.24.17 ומעלה) - הנציגים ממשיכים לכתוב ממנה, והמערכת רואה את השיחות.</li>
              <li>רשימות תפוצה (broadcast lists) באפליקציה מפסיקות לעבוד; דיוור יוצא מהמערכת.</li>
              <li>מחשבים שמחוברים ל-WhatsApp Web יתנתקו ויצטרכו להתחבר מחדש; אפליקציית WhatsApp ל-Windows לא נתמכת.</li>
              <li>הבחירה אם לשתף את היסטוריית ההודעות (6 חודשים) היא חד-פעמית - אי אפשר לבקש אותה אחר כך.</li>
              <li>יש להתחבר לפייסבוק כאדמין של הפורטפוליו העסקי שהאפליקציה שלנו שייכת לו, ולבחור בו בתהליך.</li>
            </ul>
          </Notice>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={sharedHistory} onChange={(e) => setSharedHistory(e.target.checked)} />
            לשתף את היסטוריית ההודעות של 6 החודשים האחרונים (מומלץ - הכרטיסים יקבלו את השיחות הקיימות)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void connect()} disabled={!settings.signup || connecting}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              חבר את WhatsApp של החברה
            </Button>
            {!settings.signup && <span className="text-sm text-muted-foreground">חסרים NEXT_PUBLIC_WHATSAPP_APP_ID / NEXT_SECRET_WHATSAPP_CONFIG_ID ב-Vercel</span>}
          </div>
          {events.length > 0 && (
            <ol className="space-y-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
              {events.map((e, i) => (
                <li key={i}>
                  {fmtInstant(e.at)} {e.event}: {e.detail}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Number</dt>
              <dd dir="ltr" className="font-medium">
                {account.displayPhone}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Verified name</dt>
              <dd dir="auto">{account.verifiedName ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Mode</dt>
              <dd dir="auto">{MODE_LABELS[account.mode] ?? account.mode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Quality</dt>
              <dd>{account.qualityRating ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Messaging tier</dt>
              <dd>{account.messagingLimit ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">History</dt>
              <dd dir="auto">
                {account.historySyncedAt
                  ? `synced ${fmtInstant(account.historySyncedAt)}`
                  : account.historyRequestedAt
                    ? "ההיסטוריה טרם סונכרנה - יש 24 שעות"
                    : "not requested"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Connected</dt>
              <dd dir="ltr">{fmtInstant(account.connectedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sending token</dt>
              <dd>{settings.tokenSet ? "set in Vercel" : "NOT set - NEXT_SECRET_WHATSAPP_TOKEN"}</dd>
            </div>
          </dl>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-medium">Templates</h4>
              <Button variant="outline" size="sm" onClick={() => void sync()} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                סנכרן תבניות
              </Button>
            </div>
            {settings.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates in the cache yet - sync them from Meta.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-start font-medium">Name</th>
                    <th className="py-1 text-start font-medium">Language</th>
                    <th className="py-1 text-start font-medium">Category</th>
                    <th className="py-1 text-start font-medium">Status</th>
                    <th className="py-1 text-start font-medium">Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.templates.map((t) => (
                    <tr key={`${t.name}:${t.language}`} className="border-t">
                      <td className="py-1 font-mono">{t.name}</td>
                      <td className="py-1">{t.language}</td>
                      <td className="py-1">{t.category ?? "-"}</td>
                      <td className="py-1">{t.status}</td>
                      <td className="py-1" dir="ltr">
                        {fmtInstant(t.syncedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={testTemplate} onValueChange={setTestTemplate}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={approved.length ? "Template for the test" : "No approved template"} />
              </SelectTrigger>
              <SelectContent>
                {approved.map((t) => (
                  <SelectItem key={`${t.name}:${t.language}`} value={t.name}>
                    {t.name} · {t.language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing || !settings.staffPhone || !testTemplate}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              שלח בדיקה אליי
            </Button>
            {!settings.staffPhone && <span className="text-xs text-muted-foreground">Add your phone to your user profile to receive a test.</span>}
          </div>
        </div>
      )}
    </Section>
  );
}
