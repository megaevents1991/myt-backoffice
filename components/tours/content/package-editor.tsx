"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Info, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { UrlTabs } from "@/components/url-tabs";
import { useConfirm } from "@/components/confirm-provider";
import { useToast } from "@/hooks/use-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { deleteTourPackage, saveTourItinerary, saveTourPackage } from "@/lib/actions/tours-content-actions";
import { Chip, Field, Section } from "@/components/tours/ui";
import {
  ImageListEditor,
  ImageUrlField,
  NO_UPLOAD_NOTE,
  RowControls,
  StringListEditor,
  moved,
} from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { ItineraryEditor } from "@/components/tours/content/itinerary-editor";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_SAVED_NOTE, CONTENT_UNSAVED_NOTE } from "@/components/tours/content/save-bar";
import {
  PACKAGE_BRANDS,
  PACKAGE_BRAND_COLORS,
  PACKAGE_BRAND_LABELS,
  PACKAGE_KINDS,
  PACKAGE_KIND_LABELS,
  PACKAGE_TERM_KINDS,
  TERM_KIND_LABELS,
  siteAssetUrl,
  type ItineraryVariant,
  type PackageEditorData,
  type PackageForm,
} from "@/components/tours/content/shared";

const TABS = ["general", "images", "description", "itinerary", "faq", "seo", "terms"] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  general: "General",
  images: "Images",
  description: "Description",
  itinerary: "Itinerary",
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

const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The editor of one trip page: every tab edits one form, saved together from the bar at the bottom. */
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

  const set = <K extends keyof PackageForm>(key: K, value: PackageForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const formDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.form), [form, saved.form]);
  const dirtyKeys = useMemo(() => {
    const baseline = new Map(saved.itineraries.map((v) => [v.key, variantKey(v)]));
    return variants.filter((v) => baseline.get(v.key) !== variantKey(v)).map((v) => v.key);
  }, [variants, saved.itineraries]);
  const isDirty = formDirty || dirtyKeys.length > 0;

  const problem = !form.name.trim() ? "Page name is required" : !form.slug.trim() ? "Page slug is required" : null;

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
      title: `Delete the page "${saved.form.name}"?`,
      description: "The page will be removed from the backoffice and the site. A page with series or departures cannot be deleted, only deactivated.",
      confirmLabel: "Delete Page",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setIsDeleting(true);
    const result = await run(() => deleteTourPackage(saved.id), "Page deleted");
    setIsDeleting(false);
    if (!result.success) return;
    router.push("/tours/packages");
    router.refresh();
  };

  const siteUrl = saved.siteUrl;
  const liveUrl = saved.form.isActive ? siteAssetUrl(siteUrl, `/package/${saved.form.slug}/`) : null;
  const selectedTerms = new Set(form.termIds);
  const toggleTerm = (id: string, on: boolean) =>
    set("termIds", on ? [...form.termIds, id] : form.termIds.filter((t) => t !== id));

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/packages">Back to Tour Pages</BackLink>
      <PageHeader
        eyebrow="Tour page"
        title={saved.form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={saved.form.isActive ? "outline" : "danger"}>{saved.form.isActive ? "Active on site" : "Inactive"}</Chip>
            {!saved.hasContent && <Chip>No content</Chip>}
            {saved.seriesCodes.length > 0 && (
              <span>
                Series:{" "}
                <span dir="ltr" className="font-mono">
                  {saved.seriesCodes.join(", ")}
                </span>
              </span>
            )}
            <span>{saved.departures} departures</span>
          </span>
        }
        actions={
          <>
            {liveUrl && (
              <Button asChild variant="ghost">
                <a href={liveUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  View on Site
                </a>
              </Button>
            )}
            <PublishSiteButton />
          </>
        }
      />

      {!saved.hasContent && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            The data import created this page so its series has a page, and it has no content yet. Once you add a
            description or an image and save, it counts as a page with content. To show it on the site, also mark it
            active and publish.
          </p>
        </div>
      )}

      <UrlTabs defaultValue="general" values={TABS} className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {TAB_LABELS[tab]}
              {tab === "itinerary" && dirtyKeys.length > 0 && (
                <span className="ms-1.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ------------------------------------------------------------ general */}
        <TabsContent value="general" className="space-y-4">
          <Section>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Page name">
                <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Subtitle">
                <Input dir="auto" value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
              </Field>
              <Field
                label="Slug"
                hint={
                  saved.slugLocked
                    ? "The page has departures, so its address on the site is locked."
                    : "The last part of the page address on the site. No spaces."
                }
                className="md:col-span-2"
              >
                <Input
                  dir="auto"
                  value={form.slug}
                  disabled={saved.slugLocked}
                  onChange={(e) => set("slug", e.target.value)}
                />
              </Field>
              <Field label="Type">
                <Select value={form.kind} onValueChange={(value) => set("kind", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKAGE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {PACKAGE_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Card color on site">
                <Select value={form.brand} onValueChange={(value) => set("brand", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKAGE_BRANDS.map((brand) => (
                      <SelectItem key={brand} value={brand}>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: PACKAGE_BRAND_COLORS[brand] }}
                          />
                          {PACKAGE_BRAND_LABELS[brand]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Days">
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={form.days ?? ""}
                  onChange={(e) => set("days", numberOrNull(e.target.value))}
                />
              </Field>
              <Field label="Nights">
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={form.nights ?? ""}
                  onChange={(e) => set("nights", numberOrNull(e.target.value))}
                />
              </Field>
              <Field label="Countries" hint='As shown on the site, e.g. "מדינה אחת" or "3 מדינות"'>
                <Input dir="auto" value={form.countries} onChange={(e) => set("countries", e.target.value)} />
              </Field>
              <div className="flex items-center gap-3 self-end rounded-md border p-3">
                <Switch id="pkg-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
                <label htmlFor="pkg-active" className="text-sm">
                  <span className="font-medium">Active on site</span>
                  <span className="block text-xs text-muted-foreground">An inactive page is left out of the site build.</span>
                </label>
              </div>
            </div>
            <StringListEditor
              label="Seasons"
              value={form.seasons}
              onChange={(value) => set("seasons", value)}
              placeholder="קיץ, חנוכה, פסח..."
              addLabel="Add Season"
            />
          </Section>

          <Section title="Delete Page" description="Soft delete: the page leaves the lists and the site, and its data is kept.">
            <Button type="button" variant="outline" className="text-destructive" disabled={isDeleting} onClick={() => void remove()}>
              <Trash2 />
              Delete Page
            </Button>
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ images */}
        <TabsContent value="images" className="space-y-4">
          <Section description={NO_UPLOAD_NOTE}>
            <div className="grid gap-4 lg:grid-cols-2">
              <ImageUrlField
                label="Hero image (top of the page)"
                value={form.heroImage}
                onChange={(value) => set("heroImage", value)}
                siteUrl={siteUrl}
              />
              <ImageUrlField
                label="Card image (in lists)"
                value={form.cardImage}
                onChange={(value) => set("cardImage", value)}
                siteUrl={siteUrl}
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
            />
          </Section>
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
          {form.faq.length === 0 && (
            <p className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              This page has no FAQ yet.
            </p>
          )}
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
          {PACKAGE_TERM_KINDS.map((kind) => {
            const options = saved.terms.filter((term) => term.kind === kind);
            if (options.length === 0) return null;
            const chosen = options.filter((term) => selectedTerms.has(term.id)).length;
            return (
              <Section key={kind} title={`${TERM_KIND_LABELS[kind]} (${chosen})`}>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {options.map((term) => (
                    <label key={term.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedTerms.has(term.id)}
                        onCheckedChange={(on) => toggleTerm(term.id, on === true)}
                      />
                      <span>{term.name}</span>
                      {!term.isActive && <span className="text-xs text-muted-foreground">(Inactive)</span>}
                    </label>
                  ))}
                </div>
              </Section>
            );
          })}
        </TabsContent>
      </UrlTabs>

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
