"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, PlusCircle, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, SortableHeader } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useActionToast } from "@/hooks/use-action-toast";
import { saveTourHotel } from "@/lib/actions/tours-content-actions";
import { createTourHotel } from "@/lib/actions/tours-catalog-actions";
import { Field, Notice, Section } from "@/components/tours/ui";
import { editColumn, imageColumn } from "@/components/tours/content/columns";
import { IMAGE_FIELDS_NOTE, ImageListEditor, ImageUrlField, StringListEditor } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_UNSAVED_NOTE } from "@/components/tours/content/save-bar";
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

/** The hotels the vacation packages offer, on the shared DataTable. */
export function HotelsTable({ rows, siteUrl }: { rows: HotelListRow[]; siteUrl: string | null }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<HotelListRow>[]>(
    () => [
      imageColumn<HotelListRow>(
        siteUrl,
        (row) => row.image,
        (row) => row.name,
      ),
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader label="Name" column={column} />,
        cell: ({ row }) => (
          <Link href={`/tours/hotels/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "code",
        header: ({ column }) => <SortableHeader label="Code" column={column} />,
        cell: ({ row }) => (
          <span dir="ltr" className="font-mono text-xs text-muted-foreground">
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: "city",
        header: ({ column }) => <SortableHeader label="City" column={column} />,
        cell: ({ row }) => row.original.city || <span className="text-muted-foreground">Not set</span>,
      },
      {
        accessorKey: "stars",
        header: ({ column }) => <SortableHeader label="Stars" column={column} />,
        cell: ({ row }) => <Stars count={row.original.stars} />,
      },
      editColumn(
        (row) => `/tours/hotels/${row.id}`,
        (row) => row.name,
      ),
    ],
    [siteUrl],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchColumns={["name", "city", "code"]}
      searchPlaceholder="Search by name, city or code"
      defaultPageSize={50}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(`/tours/hotels/${row.id}`)}
      stateKey="tours-hotels"
      emptyState={{
        title: rows.length === 0 ? "No hotels yet" : "No hotels match the search",
        description: rows.length === 0 ? "Add the first one with Add Hotel at the top of the page." : "Try a different search.",
      }}
    />
  );
}

/** "Add Hotel" in the page header: name, city and stars, then the hotel's page to finish it. */
export function AddHotelButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusCircle className="me-2 h-4 w-4" />
        Add Hotel
      </Button>
      {open && <AddHotelDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AddHotelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [stars, setStars] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = useActionToast();
  const problem = !name.trim() ? "Enter the hotel's name" : null;

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (problem || isPending) return;
    startTransition(async () => {
      const result = await run(
        () => createTourHotel({ name: name.trim(), city: city.trim(), stars }),
        (answer) => (answer.warning ? "Already in the list" : "Hotel added"),
      );
      if (!result.success) return;
      router.push(`/tours/hotels/${result.data.id}`);
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader className="pt-4 text-start sm:text-start">
            <DialogTitle>Add Hotel</DialogTitle>
            <DialogDescription>
              It opens on its own page next, where you add images, a description and amenities.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="new-hotel-name">
            <Input
              id="new-hotel-name"
              dir="auto"
              autoFocus
              maxLength={300}
              value={name}
              disabled={isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="new-hotel-city" className="sm:col-span-2">
              <Input
                id="new-hotel-city"
                dir="auto"
                maxLength={300}
                value={city}
                disabled={isPending}
                onChange={(event) => setCity(event.target.value)}
              />
            </Field>
            <Field label="Stars" htmlFor="new-hotel-stars">
              <Select
                value={stars ? String(stars) : "none"}
                onValueChange={(value) => setStars(value === "none" ? null : Number(value))}
                disabled={isPending}
              >
                <SelectTrigger id="new-hotel-stars">
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
          </div>
          <Notice tone="info">
            Its code (what a departure&apos;s hotel option points to) is made from the name and can be changed on the next
            page.
          </Notice>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || isPending} title={problem ?? undefined}>
              {isPending && <Loader2 className="animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <Field label="Stars" htmlFor="hotel-stars">
            <Select
              value={form.stars ? String(form.stars) : "none"}
              onValueChange={(value) => set("stars", value === "none" ? null : Number(value))}
            >
              <SelectTrigger id="hotel-stars">
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

      <Section description={IMAGE_FIELDS_NOTE}>
        <ImageUrlField label="Main image" value={form.image} onChange={(value) => set("image", value)} siteUrl={saved.siteUrl} folder="hotels" />
        <ImageListEditor label="Gallery" value={form.gallery} onChange={(value) => set("gallery", value)} siteUrl={saved.siteUrl} folder="hotels" />
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

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => void submit()}
        onDiscard={discard}
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message={CONTENT_UNSAVED_NOTE}
      />
    </div>
  );
}
