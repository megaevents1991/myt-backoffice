"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useConfirm } from "@/components/confirm-provider";
import { useToast } from "@/hooks/use-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { useActionData } from "@/hooks/use-action-data";
import { useUrlState } from "@/hooks/use-view-state";
import { deleteTourPackage, saveTourItinerary, saveTourPackage } from "@/lib/actions/tours-content-actions";
import { getTourDates } from "@/lib/actions/tours-departure-actions";
import { getSitePublishStatus } from "@/lib/tours/site-publish";
import { ActiveChip, Chip, EmptyLine, Field, LoadError, Section } from "@/components/tours/ui";
import {
  IMAGE_FIELDS_NOTE,
  ImageListEditor,
  ImageUrlField,
  RowControls,
  StringListEditor,
  moved,
} from "@/components/tours/content/fields";
import { PackageGeneralFields, PackageTermsPicker } from "@/components/tours/content/package-general-fields";
import { TourDates } from "@/components/tours/content/tour-dates";
import { TourHotelsEditor } from "@/components/tours/content/tour-hotels-editor";
import { TourReadinessStrip, tourReadiness } from "@/components/tours/content/tour-readiness";
import { HtmlField } from "@/components/tours/content/html-field";
import { ItineraryEditor } from "@/components/tours/content/itinerary-editor";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import {
  BackLink,
  CONTENT_SAVED_NOTE,
  CONTENT_UNSAVED_NOTE,
  ViewOnSiteButton,
} from "@/components/tours/content/save-bar";
import {
  siteAssetUrl,
  type ItineraryVariant,
  type PackageEditorData,
  type PackageForm,
} from "@/components/tours/content/shared";

const TABS = ["general", "images", "description", "itinerary", "dates", "hotels", "faq", "seo", "terms"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  general: "Details",
  images: "Images",
  description: "Description",
  itinerary: "Itinerary",
  dates: "Dates & Prices",
  hotels: "Hotels",
  faq: "FAQ",
  seo: "SEO",
  terms: "Categories & Tags",
};

/** A variant as it is saved: an empty image is no image. */
const variantKey = (variant: ItineraryVariant) =>
  JSON.stringify({
    label: variant.label.trim(),
    arrivalCity: variant.arrivalCity.trim().toUpperCase(),
    returnCity: variant.returnCity.trim().toUpperCase(),
    days: variant.days.map(({ image, ...day }) => (image ? { ...day, image } : day)),
  });

/**
 * The page of one tour - its "event page": details, content, dates with their
 * prices and flights, hotels. The content tabs edit one form saved from the bar
 * at the bottom; Dates & Prices saves each change as it is made, in the
 * departure card.
 */
export function PackageEditor({ initial }: { initial: PackageEditorData }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { toast } = useToast();
  const run = useActionToast();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<PackageForm>(initial.form);
  const [variants, setVariants] = useState<ItineraryVariant[]>(initial.itineraries);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [tab, setTab] = useUrlState<Tab>("tab", "general", TABS);
  const dates = useActionData(() => getTourDates(initial.id), [initial.id]);
  const publish = useActionData(() => getSitePublishStatus(), []);

  const set = <K extends keyof PackageForm>(key: K, value: PackageForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const formDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.form), [form, saved.form]);
  const dirtyKeys = useMemo(() => {
    const baseline = new Map(saved.itineraries.map((v) => [v.key, variantKey(v)]));
    return variants.filter((v) => baseline.get(v.key) !== variantKey(v)).map((v) => v.key);
  }, [variants, saved.itineraries]);
  const isDirty = formDirty || dirtyKeys.length > 0;

  const problem = !form.name.trim() ? "Tour name is required" : !form.slug.trim() ? "Slug is required" : null;
  const readiness = tourReadiness({
    form: saved.form,
    itineraries: saved.itineraries,
    terms: saved.terms,
    dates: dates.data,
    updatedAt: saved.updatedAt,
    lastPublish: publish.data?.last ?? null,
  });

  const save = async () => {
    if (problem || isSaving) return;
    setIsSaving(true);
    let latest: PackageEditorData | null = null;
    let formSaved = false;
    const savedKeys: string[] = [];
    let failed: string | null = null;
    try {
      if (formDirty) {
        const result = await saveTourPackage(saved.id, form);
        if (result.success) {
          latest = result.data;
          formSaved = true;
        } else failed = result.error;
      }
      if (!failed) {
        for (const variant of variants.filter((v) => dirtyKeys.includes(v.key))) {
          const result = await saveTourItinerary(saved.id, variant.id, {
            label: variant.label,
            arrivalCity: variant.arrivalCity,
            returnCity: variant.returnCity,
            days: variant.days,
          });
          if (!result.success) {
            failed = `${variant.label || variant.key}: ${result.error}`;
            break;
          }
          latest = result.data;
          savedKeys.push(variant.key);
        }
      }
    } catch {
      failed = "Save failed. Check your connection and try again.";
    }

    // what did reach the server becomes the new baseline; what did not stays as typed
    if (latest) {
      const fresh = latest;
      setSaved(fresh);
      if (formSaved) setForm(fresh.form);
      setVariants((current) =>
        current.map((v) => (savedKeys.includes(v.key) ? (fresh.itineraries.find((f) => f.key === v.key) ?? v) : v)),
      );
    }
    setIsSaving(false);
    // the page and its variants are several actions: one toast for the whole save
    if (failed) toast({ variant: "destructive", title: "Error", description: failed });
    else {
      toast({ title: CONTENT_SAVED_NOTE });
      router.refresh();
    }
  };

  const discard = () => {
    setForm(saved.form);
    setVariants(saved.itineraries);
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete the tour "${saved.form.name}"?`,
      description: "The tour will be removed from the backoffice and the site. A tour with series or dates cannot be deleted, only deactivated.",
      confirmLabel: "Delete Tour",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setIsDeleting(true);
    const result = await run(() => deleteTourPackage(saved.id), "Tour deleted");
    setIsDeleting(false);
    if (!result.success) return;
    router.push("/tours/packages");
    router.refresh();
  };

  const siteUrl = saved.siteUrl;
  const liveUrl = saved.form.isActive ? siteAssetUrl(siteUrl, `/package/${saved.form.slug}/`) : null;

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/packages">Back to Tours</BackLink>
      <PageHeader
        eyebrow="Tour"
        title={saved.form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ActiveChip active={saved.form.isActive} />
            {!saved.hasContent && <Chip>No content</Chip>}
            {saved.seriesCodes.length > 0 && (
              <span>
                Series:{" "}
                <span dir="ltr" className="font-mono">
                  {saved.seriesCodes.join(", ")}
                </span>
              </span>
            )}
            <span>{saved.departures} dates</span>
          </span>
        }
        actions={
          <>
            <ViewOnSiteButton href={liveUrl} />
            <PublishSiteButton />
          </>
        }
      />

      {!saved.hasContent && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            The data import created this tour so its series has a page, and it has no content yet. Once you add a
            description or an image and save, it counts as a tour with content. To show it on the site, also mark it
            active and publish.
          </p>
        </div>
      )}

      <TourReadinessStrip items={readiness} onOpen={(next) => setTab(next as Tab)} />

      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABELS[t]}
              {t === "itinerary" && dirtyKeys.length > 0 && <span className="ms-1.5 h-2 w-2 rounded-full bg-amber-500" />}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ------------------------------------------------------------ general */}
        <TabsContent value="general" className="space-y-4">
          <Section>
            <PackageGeneralFields
              form={form}
              set={set}
              slugLocked={saved.slugLocked}
              slugHint={
                saved.slugLocked
                  ? "The tour has dates, so its address on the site is locked."
                  : "The last part of the tour's address on the site. No spaces."
              }
              extra={
                <div className="flex items-center gap-3 self-end rounded-md border p-3">
                  <Switch id="pkg-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
                  <label htmlFor="pkg-active" className="text-sm">
                    <span className="font-medium">Active on site</span>
                    <span className="block text-xs text-muted-foreground">An inactive tour is left out of the site build.</span>
                  </label>
                </div>
              }
            />
          </Section>

          <Section title="Delete Tour" description="Soft delete: the tour leaves the lists and the site, and its data is kept.">
            <Button type="button" variant="outline" className="text-destructive" disabled={isDeleting} onClick={() => void remove()}>
              <Trash2 />
              Delete Tour
            </Button>
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ images */}
        <TabsContent value="images" className="space-y-4">
          <Section description={IMAGE_FIELDS_NOTE}>
            <div className="grid gap-4 lg:grid-cols-2">
              <ImageUrlField
                label="Hero image (top of the page)"
                value={form.heroImage}
                onChange={(value) => set("heroImage", value)}
                siteUrl={siteUrl}
                folder="packages"
              />
              <ImageUrlField
                label="Card image (in lists)"
                value={form.cardImage}
                onChange={(value) => set("cardImage", value)}
                siteUrl={siteUrl}
                folder="packages"
              />
            </div>
          </Section>
          <Section>
            <ImageListEditor
              label="Gallery"
              value={form.gallery}
              onChange={(value) => set("gallery", value)}
              siteUrl={siteUrl}
              hint="The order here is the order on the site."
              folder="packages"
            />
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ dates */}
        <TabsContent value="dates">
          {dates.error && !dates.data ? (
            <LoadError message={dates.error} onRetry={() => void dates.reload()} />
          ) : !dates.data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <TourDates
              tour={{ id: saved.id, name: saved.form.name, slug: saved.form.slug, kind: saved.form.kind }}
              data={dates.data}
              onChanged={() => void dates.reload({ quiet: true })}
            />
          )}
        </TabsContent>

        {/* ------------------------------------------------------------ hotels */}
        <TabsContent value="hotels" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The hotels the tour stays in, in the order the site lists them. Pick one from the hotel catalog and set this
            tour&apos;s nights and board.
          </p>
          <TourHotelsEditor
            value={form.hotels}
            onChange={(value) => set("hotels", value)}
            catalog={saved.hotelCatalog}
            siteUrl={siteUrl}
          />
        </TabsContent>

        {/* ------------------------------------------------------------ description */}
        <TabsContent value="description" className="space-y-4">
          <Section>
            <HtmlField
              label="Tour description"
              value={form.descriptionHtml}
              onChange={(value) => set("descriptionHtml", value)}
              siteUrl={siteUrl}
            />
          </Section>
          <Section>
            <StringListEditor
              label="Attractions"
              value={form.attractions}
              onChange={(value) => set("attractions", value)}
              addLabel="Add Attraction"
            />
          </Section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Section>
              <StringListEditor
                label="Included"
                value={form.included}
                onChange={(value) => set("included", value)}
              />
            </Section>
            <Section>
              <StringListEditor
                label="Not included"
                value={form.notIncluded}
                onChange={(value) => set("notIncluded", value)}
              />
            </Section>
          </div>
          <Section>
            <HtmlField
              label="Additional info"
              value={form.extraInfoHtml}
              onChange={(value) => set("extraInfoHtml", value)}
              siteUrl={siteUrl}
              rows={8}
              hint="A plain list (ul / li) shows on the site as bullet points. Any other HTML is shown as is."
            />
          </Section>
          <Section>
            <HtmlField
              label="Booking terms"
              value={form.termsHtml}
              onChange={(value) => set("termsHtml", value)}
              siteUrl={siteUrl}
              rows={8}
            />
          </Section>
          <Section>
            <HtmlField
              label="Cancellation terms"
              value={form.cancellationHtml}
              onChange={(value) => set("cancellationHtml", value)}
              siteUrl={siteUrl}
              rows={8}
            />
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ itinerary */}
        <TabsContent value="itinerary">
          <ItineraryEditor
            packageId={saved.id}
            variants={variants}
            dirtyKeys={dirtyKeys}
            siteUrl={siteUrl}
            onChange={setVariants}
            onVariantsChanged={(data, change) => {
              // the form may hold unsaved edits - only the itineraries move to the server's state
              setSaved((current) => ({ ...current, itineraries: data.itineraries }));
              setVariants((current) => {
                if (change.deleted) return current.filter((v) => v.key !== change.deleted);
                const created = data.itineraries.find((v) => v.key === change.created);
                return created ? [...current, created] : current;
              });
              router.refresh();
            }}
          />
        </TabsContent>

        {/* ------------------------------------------------------------ faq */}
        <TabsContent value="faq" className="space-y-3">
          {form.faq.length === 0 && <EmptyLine>This tour has no FAQ yet.</EmptyLine>}
          {form.faq.map((item, index) => (
            <Section key={index}>
              <div className="flex items-start gap-2">
                <Field label={`Question ${index + 1}`} className="min-w-0 flex-1">
                  <Input
                    dir="auto"
                    value={item.q}
                    onChange={(e) =>
                      set(
                        "faq",
                        form.faq.map((f, i) => (i === index ? { ...f, q: e.target.value } : f)),
                      )
                    }
                  />
                </Field>
                <div className="pt-6">
                  <RowControls
                    index={index}
                    count={form.faq.length}
                    onMove={(delta) => set("faq", moved(form.faq, index, delta))}
                    onRemove={() =>
                      set(
                        "faq",
                        form.faq.filter((_, i) => i !== index),
                      )
                    }
                    removeLabel="Remove Question"
                  />
                </div>
              </div>
              <HtmlField
                label="Answer"
                value={item.aHtml}
                onChange={(value) =>
                  set(
                    "faq",
                    form.faq.map((f, i) => (i === index ? { ...f, aHtml: value } : f)),
                  )
                }
                siteUrl={siteUrl}
                rows={5}
              />
            </Section>
          ))}
          <Button type="button" variant="outline" onClick={() => set("faq", [...form.faq, { q: "", aHtml: "" }])}>
            <Plus />
            Add Question
          </Button>
        </TabsContent>

        {/* ------------------------------------------------------------ seo */}
        <TabsContent value="seo">
          <Section description="What search engines and social networks show for this page.">
            <Field label="Title" hint={`${form.seoTitle.length} characters. Up to 60 recommended.`}>
              <Input dir="auto" value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
            </Field>
            <Field label="Description" hint={`${form.seoDescription.length} characters. Up to 160 recommended.`}>
              <Textarea dir="auto" rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
            </Field>
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ terms */}
        <TabsContent value="terms" className="space-y-4">
          <PackageTermsPicker terms={saved.terms} value={form.termIds} onChange={(ids) => set("termIds", ids)} />
        </TabsContent>
      </Tabs>

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
