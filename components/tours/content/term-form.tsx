"use client";

import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { saveTourTerm } from "@/lib/actions/tours-content-actions";
import { Field, ImageListEditor, NO_UPLOAD_NOTE, Pill, Section } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, ContentSaveBar } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import { termKindLabel, type TermEditorData, type TermForm } from "@/components/tours/content/shared";

/** Editor of one taxonomy term (a destination, an audience, a tag...). */
export function TermFormEditor({ initial }: { initial: TermEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<TermForm, TermEditorData>(
    initial,
    (values) => saveTourTerm(initial.id, values),
  );
  const problem = !form.name.trim() ? "חסר שם" : null;

  return (
    <div dir="rtl" className="space-y-4 pb-24">
      <BackLink href="/tours/terms">כל הקטגוריות</BackLink>
      <PageHeader
        eyebrow={termKindLabel(saved.kind)}
        title={saved.form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={saved.form.isActive ? "on" : "off"}>{saved.form.isActive ? "פעיל" : "לא פעיל"}</Pill>
            <span>כתובת: {saved.slug}</span>
          </span>
        }
        actions={<PublishSiteButton />}
      />

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="שם" className="md:col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="מיקום ברשימה" hint="מספר נמוך מופיע קודם">
            <Input
              type="number"
              min={0}
              dir="ltr"
              value={form.position}
              onChange={(e) => set("position", Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
            />
          </Field>
          <div className="flex items-center gap-3 self-end rounded-md border p-3">
            <Switch id="term-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            <label htmlFor="term-active" className="text-sm font-medium">
              פעיל באתר
            </label>
          </div>
        </div>
      </Section>

      <Section>
        <HtmlField
          label="תיאור"
          value={form.descriptionHtml}
          onChange={(value) => set("descriptionHtml", value)}
          siteUrl={saved.siteUrl}
          hint="מוצג בראש עמוד הקטגוריה באתר. הטקסט בלי העיצוב משמש גם כתיאור למנועי חיפוש."
        />
      </Section>

      <Section description={NO_UPLOAD_NOTE}>
        <ImageListEditor
          label="תמונות ראש העמוד"
          value={form.heroImages}
          onChange={(value) => set("heroImages", value)}
          siteUrl={saved.siteUrl}
        />
      </Section>

      <Section title={`עמודי טיול בקטגוריה (${saved.pages.length})`} description="השיוך נערך בלשונית קטגוריות של עמוד הטיול.">
        {saved.pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין עמודים שמשויכים לקטגוריה הזו.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {saved.pages.map((page) => (
              <li key={page.id}>
                <Link
                  href={`/tours/packages/${page.id}?tab=terms`}
                  className="rounded-md border px-2.5 py-1 text-sm hover:bg-muted"
                >
                  {page.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ContentSaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => void submit()}
        onDiscard={discard}
        disabledReason={problem}
      />
    </div>
  );
}
