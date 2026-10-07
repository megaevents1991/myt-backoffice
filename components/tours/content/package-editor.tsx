"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ActiveChip, Chip, EmptyLine, Field, LoadError, Notice, Section } from "@/components/tours/ui";
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
import { TourSeasons } from "@/components/tours/content/tour-seasons";
import { TourSeriesField } from "@/components/tours/content/tour-series-field";
import { TourHotelsEditor } from "@/components/tours/content/tour-hotels-editor";
import { TourLeadersPicker } from "@/components/tours/content/tour-leaders-picker";
import { TourReadinessStrip, tourReadiness } from "@/components/tours/content/tour-readiness";
import { HtmlField } from "@/components/tours/content/html-field";
import { PointsField } from "@/components/tours/content/points-field";
import { ItineraryEditor } from "@/components/tours/content/itinerary-editor";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import {
  BackLink,
  CONTENT_SAVED_NOTE,
  CONTENT_UNSAVED_NOTE,
  ViewOnSiteButton,
} from "@/components/tours/content/save-bar";
import {
  cleanPointsHtml,
  createProblemsKey,
  filledDays,
  siteAssetUrl,
  withTourDays,
  type ItineraryVariant,
  type PackageEditorData,
  type PackageForm,
} from "@/components/tours/content/shared";

const TABS = ["general", "images", "description", "itinerary", "seasons", "dates", "hotels", "faq", "seo", "terms"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  general: "Details",
  images: "Images",
  description: "Description",
  itinerary: "Itinerary",
  seasons: "Seasons",
  dates: "Dates & Prices",
  hotels: "Hotels",
  faq: "FAQ",
  seo: "SEO",
  terms: "Categories & Tags",
};

/** A variant as it is saved: an empty image is no image, and a blank day is not a day. */
const variantKey = (variant: ItineraryVariant) =>
  JSON.stringify({
    label: variant.label.trim(),
    arrivalCity: variant.arrivalCity.trim().toUpperCase(),
    returnCity: variant.returnCity.trim().toUpperCase(),
    days: filledDays(variant.days).map(({ image, ...day }) => (image ? { ...day, image } : day)),
  });

/** Every variant with a blank day for each day of the tour's length it lacks; the same list when none lacks one. */
const withBlankDays = (variants: ItineraryVariant[], tourDays: number | null): ItineraryVariant[] => {
  let changed = false;
  const next = variants.map((variant) => {
    const days = withTourDays(variant.days, tourDays);
    if (days === variant.days) return variant;
    changed = true;
    return { ...variant, days };
  });
  return changed ? next : variants;
};

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
  const [variants, setVariants] = useState<ItineraryVariant[]>(() => withBlankDays(initial.itineraries, initial.form.days));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [tab, setTab] = useUrlState<Tab>("tab", "general", TABS);
  // Steps Create Tour could not finish, shown once on the new tour's page
  const [createProblems, setCreateProblems] = useState<string[]>([]);
  useEffect(() => {
    try {
      const key = createProblemsKey(initial.id);
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      sessionStorage.removeItem(key);
      const list = JSON.parse(raw);
      if (Array.isArray(list)) setCreateProblems(list.filter((p): p is string => typeof p === "string"));
    } catch {
      // no storage: the toast of Create Tour already said it
    }
  }, [initial.id]);
  const dates = useActionData(() => getTourDates(initial.id), [initial.id]);
  const publish = useActionData(() => getSitePublishStatus(), []);

  const set = <K extends keyof PackageForm>(key: K, value: PackageForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // "6 days" opens six days to fill in every itinerary (Alon, 07.10.2026); a day left blank is never saved
  useEffect(() => {
    setVariants((current) => withBlankDays(current, form.days));
  }, [form.days]);

  const formDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.form), [form, saved.form]);
  const dirtyKeys = useMemo(() => {
    const baseline = new Map(saved.itineraries.map((v) => [v.key, variantKey(v)]));
    return variants.filter((v) => baseline.get(v.key) !== variantKey(v)).map((v) => v.key);
  }, [variants, saved.itineraries]);
  const isDirty = formDirty || dirtyKeys.length > 0;

  const problem = !form.name.trim() ? "Tour name is required" : !form.slug.trim() ? "Slug is required" : null;
  // the dates tab keeps these current; the loaded page only until it answers
  const dateCount = dates.data ? dates.data.rows.length : saved.departures;
  const seriesCodes = dates.data ? dates.data.series.map((s) => s.code) : saved.seriesCodes;
  const slugLocked = saved.slugLocked || dateCount > 0;
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
        const result = await saveTourPackage(saved.id, { ...form, extraInfoHtml: cleanPointsHtml(form.extraInfoHtml) });
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
            days: filledDays(variant.days),
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
        withBlankDays(
          current.map((v) => (savedKeys.includes(v.key) ? (fresh.itineraries.find((f) => f.key === v.key) ?? v) : v)),
          formSaved ? fresh.form.days : form.days,
        ),
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
    setVariants(withBlankDays(saved.itineraries, saved.form.days));
  };

  /** An itinerary was created, deleted or saved outside the page's own Save (Itinerary tab, a season): the server's state. */
  const itinerariesChanged = (data: PackageEditorData, change: { created?: string; deleted?: string; saved?: string }) => {
    // the form may hold unsaved edits - only the itineraries move to the server's state
    setSaved((current) => ({ ...current, itineraries: data.itineraries }));
    setVariants((current) => {
      if (change.deleted) return current.filter((v) => v.key !== change.deleted);
      const key = change.created ?? change.saved;
      const fresh = data.itineraries.find((v) => v.key === key);
      if (!fresh) return current;
      const next = current.some((v) => v.key === key) ? current.map((v) => (v.key === key ? fresh : v)) : [...current, fresh];
      return withBlankDays(next, form.days);
    });
    router.refresh();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete the tour "${saved.form.name}"?`,
      description:
        dateCount > 0
          ? `The tour and its ${dateCount} dates will be removed from the backoffice and the site, their flight links released and its series switched off. Only a tour with no reservations and no date on the site can be deleted; the data is kept (soft delete).`
          : "The tour will be removed from the backoffice and the site. The data is kept (soft delete).",
      confirmLabel: "Delete Tour",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setIsDeleting(true);
    const result = await run(() => deleteTourPackage(saved.id, dateCount > 0), "Tour deleted");
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
            {seriesCodes.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-base font-semibold text-foreground">
                Series:
                <span dir="ltr" className="font-mono text-lg tracking-wide">
                  {seriesCodes.join(" · ")}
                </span>
              </span>
            ) : (
              <button type="button" className="text-warning underline-offset-2 hover:underline" onClick={() => setTab("general")}>
                No series code yet
              </button>
            )}
            <span>{dateCount} dates</span>
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
            active and click Revalidate Pages.
          </p>
        </div>
      )}

      {createProblems.length > 0 && (
        <Notice tone="warning">
          <p className="font-medium">Create Tour could not finish {createProblems.length} steps. Finish them here:</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {createProblems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setCreateProblems([])}>
            Dismiss
          </Button>
        </Notice>
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
          <TourSeriesField
            packageId={saved.id}
            series={dates.data?.series ?? null}
            fallbackCodes={saved.seriesCodes}
            hasDates={dateCount > 0}
            onChanged={() => {
              void dates.reload({ quiet: true });
              router.refresh();
            }}
          />
          <Section>
            <PackageGeneralFields
              form={form}
              set={set}
              terms={saved.terms}
              showSeasons={false}
              slugLocked={slugLocked}
              slugHint={
                slugLocked
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

          <Section
            title="Group Leaders"
            description="Who escorts this tour - listed on the tour page on the site. The leader of each date is set in its card (Dates & Prices)."
          >
            <TourLeadersPicker
              value={form.leaderIds}
              onChange={(ids) => set("leaderIds", ids)}
              options={saved.leaderOptions}
              onOptionCreated={(leader) => setSaved((s) => ({ ...s, leaderOptions: [...s.leaderOptions, leader] }))}
              siteUrl={siteUrl}
            />
          </Section>

          <Section
            title="Delete Tour"
            description="For a tour created by mistake: possible while nothing was sold on it and no date is on the site. Otherwise deactivate it. The data is kept (soft delete)."
          >
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
            <PointsField
              label="Additional info"
              value={form.extraInfoHtml}
              onChange={(value) => set("extraInfoHtml", value)}
              siteUrl={siteUrl}
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
            rows={dates.data?.rows ?? null}
            tourDays={form.days}
            onDatesChanged={() => {
              void dates.reload({ quiet: true });
              router.refresh();
            }}
            onChange={setVariants}
            onVariantsChanged={itinerariesChanged}
          />
        </TabsContent>

        {/* ------------------------------------------------------------ seasons */}
        <TabsContent value="seasons">
          <TourSeasons
            packageId={saved.id}
            rows={dates.data?.rows ?? null}
            variants={saved.itineraries}
            dirtyKeys={dirtyKeys}
            tour={form}
            onItinerariesChanged={itinerariesChanged}
            siteUrl={siteUrl}
            onChanged={(names) => {
              void dates.reload({ quiet: true });
              if (names) {
                // the tour's season list follows its seasons - the form must not write the old list back
                setSaved((current) => ({ ...current, form: { ...current.form, seasons: names } }));
                setForm((current) => ({ ...current, seasons: names }));
              }
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
          <PackageTermsPicker
            terms={saved.terms}
            value={form.termIds}
            brand={form.brand}
            onChange={(ids) => set("termIds", ids)}
            onTermCreated={(term) =>
              setSaved((s) => ({
                ...s,
                terms: s.terms.some((t) => t.id === term.id) ? s.terms.map((t) => (t.id === term.id ? { ...t, ...term } : t)) : [...s.terms, term],
              }))
            }
          />
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
