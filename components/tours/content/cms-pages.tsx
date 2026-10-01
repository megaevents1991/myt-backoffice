"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/search-input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { useSessionState } from "@/hooks/use-view-state";
import { matchesSearch } from "@/lib/search";
import { saveTourCmsPage } from "@/lib/actions/tours-content-actions";
import { Field, Pill, Section } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, ContentSaveBar, EmptyRows } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import {
  cmsPageKindLabel,
  siteAssetUrl,
  type CmsPageEditorData,
  type CmsPageForm,
  type CmsPageListRow,
} from "@/components/tours/content/shared";

/** The free content pages of the site (about, FAQ, legal, contact) and its posts. */
export function CmsPagesTable({ rows }: { rows: CmsPageListRow[] }) {
  const [query, setQuery] = useSessionState("q", "");
  const shown = useMemo(() => rows.filter((r) => matchesSearch(query, r.title, r.path)), [rows, query]);

  return (
    <div className="space-y-3">
      <SearchInput value={query} onValueChange={setQuery} placeholder="חיפוש לפי כותרת או כתובת" />
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead>כותרת</TableHead>
              <TableHead>כתובת באתר</TableHead>
              <TableHead>סוג</TableHead>
              <TableHead>תוכן</TableHead>
              <TableHead>מצב</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/tours/pages/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <span dir="ltr" className="inline-block">
                    {row.path}
                  </span>
                </TableCell>
                <TableCell>{cmsPageKindLabel(row.kind)}</TableCell>
                <TableCell>
                  {row.hasContent ? <Badge variant="outline">יש תוכן</Badge> : <Badge variant="secondary">ריק</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "outline" : "destructive"}>{row.isActive ? "פעיל" : "לא פעיל"}</Badge>
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/pages/${row.id}`} aria-label={`עריכת ${row.title}`} title="עריכה">
                      <Pencil />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {shown.length === 0 && (
          <EmptyRows
            title={rows.length === 0 ? "עוד אין עמודי תוכן" : "אין עמודים שמתאימים לחיפוש"}
            description={rows.length === 0 ? "עמודי התוכן נוצרים בטעינת הנתונים של האתר." : "נסו חיפוש אחר."}
          />
        )}
      </div>
    </div>
  );
}

/** Editor of one content page. The address is fixed: other pages and the menus link to it. */
export function CmsPageFormEditor({ initial }: { initial: CmsPageEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<CmsPageForm, CmsPageEditorData>(
    initial,
    (values) => saveTourCmsPage(initial.id, values),
  );
  const problem = !form.title.trim() ? "חסרה כותרת" : null;
  const liveUrl = saved.form.isActive ? siteAssetUrl(saved.siteUrl, saved.path) : null;

  return (
    <div dir="rtl" className="space-y-4 pb-24">
      <BackLink href="/tours/pages">כל עמודי התוכן</BackLink>
      <PageHeader
        eyebrow={cmsPageKindLabel(saved.kind)}
        title={saved.form.title}
        description={
          <Pill tone={saved.form.isActive ? "on" : "off"}>{saved.form.isActive ? "פעיל באתר" : "לא פעיל"}</Pill>
        }
        actions={
          <>
            {liveUrl && (
              <Button asChild variant="ghost">
                <a href={liveUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  צפייה באתר
                </a>
              </Button>
            )}
            <PublishSiteButton />
          </>
        }
      />

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="כותרת" className="md:col-span-2">
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="כתובת באתר" hint="קבועה: תפריטים ועמודים אחרים מקשרים אליה.">
            <Input dir="ltr" className="text-end" value={saved.path} readOnly disabled />
          </Field>
          <div className="flex items-center gap-3 self-start rounded-md border p-3 md:mt-6">
            <Switch id="page-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            <label htmlFor="page-active" className="text-sm font-medium">
              פעיל באתר
            </label>
          </div>
        </div>
      </Section>

      <Section>
        <HtmlField
          label="תוכן העמוד"
          value={form.contentHtml}
          onChange={(value) => set("contentHtml", value)}
          siteUrl={saved.siteUrl}
          rows={22}
          hint="התצוגה המקדימה מציגה את התוכן בלי עיצוב האתר, ולכן עמוד שיובא מוורדפרס נראה כאן פשוט יותר מאשר באתר."
        />
      </Section>

      <Section title="SEO" description="מה שמנועי החיפוש והרשתות החברתיות מציגים על העמוד.">
        <Field label="כותרת (title)" hint={`${form.seoTitle.length} תווים. מומלץ עד 60.`}>
          <Input value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
        </Field>
        <Field label="תיאור (description)" hint={`${form.seoDescription.length} תווים. מומלץ עד 160.`}>
          <Textarea rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
        </Field>
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
