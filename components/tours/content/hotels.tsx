"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { useSessionState } from "@/hooks/use-view-state";
import { matchesSearch } from "@/lib/search";
import { saveTourHotel } from "@/lib/actions/tours-content-actions";
import {
  Field,
  ImageListEditor,
  ImageUrlField,
  NO_UPLOAD_NOTE,
  Section,
  SiteImage,
  StringListEditor,
} from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, ContentSaveBar, EmptyRows } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import type { HotelEditorData, HotelForm, HotelListRow } from "@/components/tours/content/shared";

const Stars = ({ count }: { count: number | null }) =>
  count ? (
    <span className="inline-flex items-center gap-0.5" title={`${count} כוכבים`}>
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      ))}
    </span>
  ) : (
    <span className="text-muted-foreground">לא צוין</span>
  );

/** The hotels the vacation packages offer. */
export function HotelsTable({ rows, siteUrl }: { rows: HotelListRow[]; siteUrl: string | null }) {
  const [query, setQuery] = useSessionState("q", "");
  const shown = useMemo(() => rows.filter((r) => matchesSearch(query, r.name, r.city, r.code)), [rows, query]);

  return (
    <div className="space-y-3">
      <SearchInput value={query} onValueChange={setQuery} placeholder="חיפוש לפי שם, עיר או קוד" />
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px]">תמונה</TableHead>
              <TableHead>שם</TableHead>
              <TableHead>קוד</TableHead>
              <TableHead>עיר</TableHead>
              <TableHead>כוכבים</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <SiteImage siteUrl={siteUrl} path={row.image} className="h-10 w-14" alt={row.name} />
                </TableCell>
                <TableCell>
                  <Link href={`/tours/hotels/${row.id}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {row.code}
                  </span>
                </TableCell>
                <TableCell>{row.city || <span className="text-muted-foreground">לא צוין</span>}</TableCell>
                <TableCell>
                  <Stars count={row.stars} />
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/hotels/${row.id}`} aria-label={`עריכת ${row.name}`} title="עריכה">
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
            title={rows.length === 0 ? "עוד אין מלונות" : "אין מלונות שמתאימים לחיפוש"}
            description={rows.length === 0 ? "המלונות נוצרים בטעינת הנתונים של האתר." : "נסו חיפוש אחר."}
          />
        )}
      </div>
    </div>
  );
}

/** Editor of one hotel. */
export function HotelFormEditor({ initial }: { initial: HotelEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<HotelForm, HotelEditorData>(
    initial,
    (values) => saveTourHotel(initial.id, values),
  );
  const problem = !form.name.trim() ? "חסר שם" : !form.code.trim() ? "חסר קוד" : null;
  const codeLocked = saved.optionsUsingCode > 0;

  return (
    <div dir="rtl" className="space-y-4 pb-24">
      <BackLink href="/tours/hotels">כל המלונות</BackLink>
      <PageHeader eyebrow="מלון" title={saved.form.name} actions={<PublishSiteButton />} />

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="שם" className="md:col-span-2">
            <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field
            label="קוד"
            className="md:col-span-2"
            hint={
              codeLocked
                ? `יש אפשרויות ביציאות שמצביעות על הקוד הזה (${saved.optionsUsingCode}), ולכן הוא נעול.`
                : "הקוד שאפשרות מלון ביציאה מצביעה עליו. בלי רווחים."
            }
          >
            <Input
              dir="ltr"
              className="font-mono text-xs"
              value={form.code}
              disabled={codeLocked}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
          <Field label="עיר" className="md:col-span-2">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="כוכבים">
            <Select
              value={form.stars ? String(form.stars) : "none"}
              onValueChange={(value) => set("stars", value === "none" ? null : Number(value))}
            >
              <SelectTrigger dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="none">לא צוין</SelectItem>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="תקציר" hint="הטקסט הקצר בכרטיס המלון" className="md:col-span-4">
            <Textarea rows={4} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section description={NO_UPLOAD_NOTE}>
        <ImageUrlField label="תמונה ראשית" value={form.image} onChange={(value) => set("image", value)} siteUrl={saved.siteUrl} />
        <ImageListEditor label="גלריה" value={form.gallery} onChange={(value) => set("gallery", value)} siteUrl={saved.siteUrl} />
      </Section>

      <Section>
        <HtmlField
          label="תיאור המלון"
          value={form.contentHtml}
          onChange={(value) => set("contentHtml", value)}
          siteUrl={saved.siteUrl}
          rows={12}
        />
      </Section>

      <Section>
        <StringListEditor
          label="מתקנים ושירותים"
          value={form.amenities}
          onChange={(value) => set("amenities", value)}
          placeholder="WiFi חינם, בריכה, חדר כושר..."
          addLabel="הוספת מתקן"
        />
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
