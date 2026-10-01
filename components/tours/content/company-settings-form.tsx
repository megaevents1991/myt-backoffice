"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { toast } from "react-hot-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveCompanySettings } from "@/lib/actions/tours-settings-actions";
import { Field, Section, SiteImage } from "@/components/tours/content/fields";
import { ContentSaveBar } from "@/components/tours/content/save-bar";
import { CompanyMembers } from "@/components/tours/content/company-members";
import {
  formatDayTime,
  type CompanySettingsData,
  type CompanySettingsForm,
  type DeployHookChange,
} from "@/components/tours/content/shared";

const CURRENCIES = ["USD", "EUR", "GBP", "ILS"];

/** Settings of the active company. The deploy hook is write-only: it can be replaced or removed, never read back. */
export function CompanySettingsFormEditor({ initial }: { initial: CompanySettingsData }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<CompanySettingsForm>(initial.form);
  const [hookUrl, setHookUrl] = useState("");
  const [clearHook, setClearHook] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const formDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.form), [form, saved.form]);
  const isDirty = formDirty || hookUrl.trim() !== "" || clearHook;

  const set = <K extends keyof CompanySettingsForm>(key: K, value: CompanySettingsForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setIn = <K extends "contact" | "brand" | "email" | "analytics">(
    group: K,
    key: keyof CompanySettingsForm[K],
    value: string,
  ) => setForm((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));

  const problem = !form.name.trim() ? "חסר שם לחברה" : null;

  const save = async () => {
    if (problem || isSaving) return;
    const hook: DeployHookChange = hookUrl.trim()
      ? { action: "set", url: hookUrl.trim() }
      : clearHook
        ? { action: "clear" }
        : { action: "keep" };
    setIsSaving(true);
    const result = await saveCompanySettings(form, hook).catch(() => null);
    setIsSaving(false);
    if (!result || !result.success) {
      toast.error(result ? result.error : "השמירה נכשלה. בדקו את החיבור ונסו שוב.", { duration: 7000 });
      return;
    }
    setSaved(result.data);
    setForm(result.data.form);
    setHookUrl("");
    setClearHook(false);
    toast.success("הגדרות החברה נשמרו");
    router.refresh();
  };

  const discard = () => {
    setForm(saved.form);
    setHookUrl("");
    setClearHook(false);
  };

  const last = saved.lastPublish;

  return (
    <div className="space-y-4 pb-24">
      <Section title="פרטי החברה">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="שם החברה" hint="השם שמוצג בבקאופיס ובבורר החברות">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="שם משפטי" hint='למשל: מגה תיירות בע"מ ח.פ 511910804'>
            <Input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </Field>
          <Field label="כתובת האתר" hint="התמונות בעמודי התוכן (‎/media/...‎) נטענות מהכתובת הזו">
            <Input dir="ltr" placeholder="https://" value={form.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} />
          </Field>
          <Field label="מטבע ברירת מחדל">
            <Select value={form.defaultCurrency} onValueChange={(value) => set("defaultCurrency", value)}>
              <SelectTrigger dir="ltr">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...CURRENCIES, form.defaultCurrency])].map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="פרטי קשר" description="מוצגים בראש האתר, בתחתית ובעמוד צור קשר.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="טלפון">
            <Input dir="ltr" value={form.contact.phone} onChange={(e) => setIn("contact", "phone", e.target.value)} />
          </Field>
          <Field label="WhatsApp">
            <Input dir="ltr" value={form.contact.whatsapp} onChange={(e) => setIn("contact", "whatsapp", e.target.value)} />
          </Field>
          <Field label="אימייל">
            <Input dir="ltr" type="email" value={form.contact.email} onChange={(e) => setIn("contact", "email", e.target.value)} />
          </Field>
          <Field label="כתובת">
            <Input value={form.contact.address} onChange={(e) => setIn("contact", "address", e.target.value)} />
          </Field>
          <Field label="שעות פעילות" hint="שורה לכל טווח, למשל: א'-ה' : 09:00-17:00" className="md:col-span-2">
            <Textarea rows={3} value={form.contact.hours} onChange={(e) => setIn("contact", "hours", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="מיתוג">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="לוגו" hint="כתובת התמונה באתר (‎/media/...‎) או כתובת מלאה">
            <div className="flex items-center gap-3">
              <SiteImage siteUrl={saved.form.siteUrl} path={form.brand.logo} className="h-12 w-24 shrink-0 object-contain" alt="לוגו" />
              <Input dir="ltr" className="font-mono text-xs" value={form.brand.logo} onChange={(e) => setIn("brand", "logo", e.target.value)} />
            </div>
          </Field>
          <Field label="צבע ראשי" hint="בפורמט ‎#RRGGBB‎">
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label="בחירת צבע"
                className="h-10 w-12 shrink-0 cursor-pointer rounded border bg-background p-1"
                value={/^#[0-9a-fA-F]{6}$/.test(form.brand.primaryColor) ? form.brand.primaryColor : "#60356c"}
                onChange={(e) => setIn("brand", "primaryColor", e.target.value)}
              />
              <Input
                dir="ltr"
                className="font-mono"
                placeholder="#60356C"
                value={form.brand.primaryColor}
                onChange={(e) => setIn("brand", "primaryColor", e.target.value)}
              />
            </div>
          </Field>
        </div>
      </Section>

      <Section title="אימייל" description="מי השולח של הודעות האתר ולאן מגיעות הפניות.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="שולח (from)" hint='למשל: מגה פמילי <no-reply@megatr.co.il>'>
            <Input dir="ltr" value={form.email.from} onChange={(e) => setIn("email", "from", e.target.value)} />
          </Field>
          <Field label="כתובת למענה (reply-to)">
            <Input dir="ltr" type="email" value={form.email.replyTo} onChange={(e) => setIn("email", "replyTo", e.target.value)} />
          </Field>
          <Field label="תיבת הלידים" hint="לכאן נשלחת התראה על ליד חדש">
            <Input dir="ltr" type="email" value={form.email.leadsInbox} onChange={(e) => setIn("email", "leadsInbox", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="מדידה">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Google Tag Manager" hint="מזהה בפורמט GTM-XXXXXXX">
            <Input dir="ltr" className="font-mono" value={form.analytics.gtm} onChange={(e) => setIn("analytics", "gtm", e.target.value)} />
          </Field>
          <Field label="Meta Pixel" hint="מזהה הפיקסל (מספר)">
            <Input dir="ltr" className="font-mono" value={form.analytics.pixel} onChange={(e) => setIn("analytics", "pixel", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="פרסום לאתר"
        description='הכפתור "פרסום לאתר" בונה את האתר מחדש דרך כתובת deploy hook של Vercel. הכתובת היא סוד: מי שמחזיק בה יכול להפעיל בנייה, ולכן היא לא מוצגת אחרי השמירה. אפשר רק להחליף או להסיר אותה.'
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {saved.deployHookSet ? (
            <Badge variant="outline" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              מוגדר
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5">
              <CircleSlash className="h-3.5 w-3.5" />
              לא מוגדר
            </Badge>
          )}
          <span className="text-muted-foreground">
            {last
              ? `${last.ok ? "פרסום אחרון" : "ניסיון אחרון נכשל"}: ${formatDayTime(last.at)} · ${last.by}${last.status ? ` · HTTP ${last.status}` : ""}`
              : "האתר עוד לא פורסם מהבקאופיס."}
          </span>
        </div>
        <Field
          label={saved.deployHookSet ? "החלפת הכתובת" : "כתובת ה-deploy hook"}
          hint="משאירים ריק כדי לא לשנות. הכתובת נשמרת בלחיצה על שמירה."
        >
          <Input
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="https://api.vercel.com/v1/integrations/deploy/..."
            value={hookUrl}
            disabled={clearHook}
            onChange={(e) => setHookUrl(e.target.value)}
          />
        </Field>
        {saved.deployHookSet && (
          <Button
            type="button"
            variant={clearHook ? "destructive" : "outline"}
            size="sm"
            onClick={() => {
              setClearHook(!clearHook);
              setHookUrl("");
            }}
          >
            {clearHook ? "הכתובת תוסר בשמירה (לחצו לביטול)" : "הסרת הכתובת"}
          </Button>
        )}
      </Section>

      <CompanyMembers initial={saved.members} companyName={saved.form.name} />

      <ContentSaveBar isDirty={isDirty} isSaving={isSaving} onSave={() => void save()} onDiscard={discard} disabledReason={problem} />
    </div>
  );
}
