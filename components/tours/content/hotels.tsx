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
    <span className="inline-flex items-center gap-0.5" title={`${count} stars`}>
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      ))}
    </span>
  ) : (
    <span className="text-muted-foreground">Not set</span>
  );

/** The hotels the vacation packages offer. */
export function HotelsTable({ rows, siteUrl }: { rows: HotelListRow[]; siteUrl: string | null }) {
  const [query, setQuery] = useSessionState("q", "");
  const shown = useMemo(() => rows.filter((r) => matchesSearch(query, r.name, r.city, r.code)), [rows, query]);

  return (
    <div className="space-y-3">
      <SearchInput value={query} onValueChange={setQuery} placeholder="Search by name, city or code" />
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px]">Image</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Stars</TableHead>
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
                <TableCell>{row.city || <span className="text-muted-foreground">Not set</span>}</TableCell>
                <TableCell>
                  <Stars count={row.stars} />
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/hotels/${row.id}`} aria-label={`Edit ${row.name}`} title="Edit">
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
            title={rows.length === 0 ? "No hotels yet" : "No hotels match the search"}
            description={rows.length === 0 ? "Hotels are created when the site's data is imported." : "Try a different search."}
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
  const problem = !form.name.trim() ? "Name is required" : !form.code.trim() ? "Code is required" : null;
  const codeLocked = saved.optionsUsingCode > 0;

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/hotels">Back to Hotels</BackLink>
      <PageHeader eyebrow="Hotel" title={saved.form.name} actions={<PublishSiteButton />} />

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Name" className="md:col-span-2">
            <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field
            label="Code"
            className="md:col-span-2"
            hint={
              codeLocked
                ? `Departure options point to this code (${saved.optionsUsingCode}), so it is locked.`
                : "The code a departure's hotel option points to. No spaces."
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
          <Field label="City" className="md:col-span-2">
            <Input dir="auto" value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Stars">
            <Select
              value={form.stars ? String(form.stars) : "none"}
              onValueChange={(value) => set("stars", value === "none" ? null : Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Excerpt" hint="The short text on the hotel card" className="md:col-span-4">
            <Textarea dir="auto" rows={4} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section description={NO_UPLOAD_NOTE}>
        <ImageUrlField label="Main image" value={form.image} onChange={(value) => set("image", value)} siteUrl={saved.siteUrl} />
        <ImageListEditor label="Gallery" value={form.gallery} onChange={(value) => set("gallery", value)} siteUrl={saved.siteUrl} />
      </Section>

      <Section>
        <HtmlField
          label="Hotel description"
          value={form.contentHtml}
          onChange={(value) => set("contentHtml", value)}
          siteUrl={saved.siteUrl}
          rows={12}
        />
      </Section>

      <Section>
        <StringListEditor
          label="Facilities & services"
          value={form.amenities}
          onChange={(value) => set("amenities", value)}
          placeholder="WiFi חינם, בריכה, חדר כושר..."
          addLabel="Add Facility"
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
