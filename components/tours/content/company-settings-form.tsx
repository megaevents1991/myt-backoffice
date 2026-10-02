"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleSlash } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useActionToast } from "@/hooks/use-action-toast";
import { ALL_CURRENCIES, fmtInstant } from "@/lib/tours/format";
import { saveCompanySettings } from "@/lib/actions/tours-settings-actions";
import { CurrencySelect, Field, Section } from "@/components/tours/ui";
import { SiteImage } from "@/components/tours/content/fields";
import { CONTENT_UNSAVED_NOTE } from "@/components/tours/content/save-bar";
import type { CompanySettingsData, CompanySettingsForm, DeployHookChange } from "@/components/tours/content/shared";

/** Settings of the active company. The deploy hook is write-only: it can be replaced or removed, never read back. */
export function CompanySettingsFormEditor({ initial }: { initial: CompanySettingsData }) {
  const router = useRouter();
  const run = useActionToast();
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

  const problem = !form.name.trim() ? "Company name is required" : null;

  const save = async () => {
    if (problem || isSaving) return;
    const hook: DeployHookChange = hookUrl.trim()
      ? { action: "set", url: hookUrl.trim() }
      : clearHook
        ? { action: "clear" }
        : { action: "keep" };
    setIsSaving(true);
    const result = await run(() => saveCompanySettings(form, hook), "Settings saved");
    setIsSaving(false);
    if (!result.success) return;
    setSaved(result.data);
    setForm(result.data.form);
    setHookUrl("");
    setClearHook(false);
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
      <Section title="Company details">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company name" hint="The name shown in the backoffice and the company switcher">
            <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Legal name" hint='e.g. מגה תיירות בע"מ ח.פ 511910804'>
            <Input dir="auto" value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </Field>
          <Field label="Site URL" hint="Images on the content pages (/media/...) load from this address">
            <Input dir="ltr" placeholder="https://" value={form.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} />
          </Field>
          <Field label="Default currency" htmlFor="company-currency">
            <CurrencySelect
              id="company-currency"
              className="h-10 w-full"
              value={form.defaultCurrency}
              onChange={(value) => set("defaultCurrency", value)}
              // a stored currency outside the list still shows (saving asks for one of the list)
              currencies={[...new Set([...ALL_CURRENCIES, form.defaultCurrency])]}
            />
          </Field>
        </div>
      </Section>

      <Section title="Contact details" description="Shown in the site header, the footer and the contact page.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Phone">
            <Input dir="ltr" value={form.contact.phone} onChange={(e) => setIn("contact", "phone", e.target.value)} />
          </Field>
          <Field label="WhatsApp">
            <Input dir="ltr" value={form.contact.whatsapp} onChange={(e) => setIn("contact", "whatsapp", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input dir="ltr" type="email" value={form.contact.email} onChange={(e) => setIn("contact", "email", e.target.value)} />
          </Field>
          <Field label="Address">
            <Input dir="auto" value={form.contact.address} onChange={(e) => setIn("contact", "address", e.target.value)} />
          </Field>
          <Field label="Opening hours" hint="One line per range, e.g. א'-ה' : 09:00-17:00" className="md:col-span-2">
            <Textarea dir="auto" rows={3} value={form.contact.hours} onChange={(e) => setIn("contact", "hours", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Brand">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Logo" hint="The image path on the site (/media/...) or a full URL">
            <div className="flex items-center gap-3">
              <SiteImage siteUrl={saved.form.siteUrl} path={form.brand.logo} className="h-12 w-24 shrink-0 object-contain" alt="Logo" />
              <Input dir="ltr" className="font-mono text-xs" value={form.brand.logo} onChange={(e) => setIn("brand", "logo", e.target.value)} />
            </div>
          </Field>
          <Field label="Primary color" hint="In #RRGGBB format" htmlFor="brand-primary-color">
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label="Pick a color"
                className="h-10 w-12 shrink-0 cursor-pointer rounded border bg-background p-1"
                value={/^#[0-9a-fA-F]{6}$/.test(form.brand.primaryColor) ? form.brand.primaryColor : "#60356c"}
                onChange={(e) => setIn("brand", "primaryColor", e.target.value)}
              />
              <Input
                id="brand-primary-color"
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

      <Section title="Email" description="Who sends the site's emails and where inquiries arrive.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="From" hint='e.g. מגה פמילי <no-reply@megatr.co.il>'>
            <Input dir="ltr" value={form.email.from} onChange={(e) => setIn("email", "from", e.target.value)} />
          </Field>
          <Field label="Reply-to">
            <Input dir="ltr" type="email" value={form.email.replyTo} onChange={(e) => setIn("email", "replyTo", e.target.value)} />
          </Field>
          <Field label="Leads email" hint="New lead notifications are sent here">
            <Input dir="ltr" type="email" value={form.email.leadsInbox} onChange={(e) => setIn("email", "leadsInbox", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Analytics">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Google Tag Manager" hint="ID in GTM-XXXXXXX format">
            <Input dir="ltr" className="font-mono" value={form.analytics.gtm} onChange={(e) => setIn("analytics", "gtm", e.target.value)} />
          </Field>
          <Field label="Meta Pixel" hint="The pixel ID (a number)">
            <Input dir="ltr" className="font-mono" value={form.analytics.pixel} onChange={(e) => setIn("analytics", "pixel", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="Revalidate Pages"
        description='The "Revalidate Pages" button rebuilds the site through a Vercel deploy hook URL. The URL is a secret: anyone who has it can trigger a build, so it is not shown after saving. You can only replace or remove it.'
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {saved.deployHookSet ? (
            <Badge variant="outline" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Set up
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5">
              <CircleSlash className="h-3.5 w-3.5" />
              Not set up
            </Badge>
          )}
          <span className="text-muted-foreground">
            {last
              ? `${last.ok ? "Last published" : "Last attempt failed"}: ${fmtInstant(last.at)} · ${last.by}${last.status ? ` · HTTP ${last.status}` : ""}`
              : "The site has not been published from the backoffice yet."}
          </span>
        </div>
        <Field
          label={saved.deployHookSet ? "Replace URL" : "Deploy hook URL"}
          hint="Leave empty to keep it unchanged. The URL is stored when you save."
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
            {clearHook ? "URL will be removed on save (click to undo)" : "Remove URL"}
          </Button>
        )}
      </Section>

      <Section title="People">
        <p className="text-sm text-muted-foreground">
          People and roles are managed in{" "}
          <Link href="/users" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
            Users
          </Link>
          .
        </p>
      </Section>

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => void save()}
        onDiscard={discard}
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message={CONTENT_UNSAVED_NOTE}
      />
    </div>
  );
}
