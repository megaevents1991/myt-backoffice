"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { UrlTabs } from "@/components/url-tabs";
import { useConfirm } from "@/components/confirm-provider";
import { deleteTourPackage, saveTourItinerary, saveTourPackage } from "@/lib/actions/tours-content-actions";
import {
  Field,
  ImageListEditor,
  ImageUrlField,
  NO_UPLOAD_NOTE,
  Pill,
  RowControls,
  Section,
  StringListEditor,
  moved,
} from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { ItineraryEditor } from "@/components/tours/content/itinerary-editor";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, ContentSaveBar } from "@/components/tours/content/save-bar";
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
  general: "כללי",
  images: "תמונות",
  description: "תיאור",
  itinerary: "מסלול יומי",
  faq: "שאלות נפוצות",
  seo: "SEO",
  terms: "קטגוריות",
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

  const problem = !form.name.trim() ? "חסר שם לעמוד" : !form.slug.trim() ? "חסרה כתובת לעמוד" : null;

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
      failed = "השמירה נכשלה. בדקו את החיבור ונסו שוב.";
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
    if (failed) toast.error(failed, { duration: 7000 });
    else {
      toast.success("נשמר. כדי שהשינוי יופיע באתר, לחצו על פרסום לאתר.");
      router.refresh();
    }
  };

  const discard = () => {
    setForm(saved.form);
    setVariants(saved.itineraries);
  };

  const remove = async () => {
    const ok = await confirm({
      title: `למחוק את העמוד "${saved.form.name}"?`,
      description: "העמוד יוסר מהבקאופיס ומהאתר. עמוד שיש עליו סדרות או יציאות אי אפשר למחוק, רק לכבות.",
      confirmLabel: "מחיקת העמוד",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!ok) return;
    setIsDeleting(true);
    const result = await deleteTourPackage(saved.id);
    setIsDeleting(false);
    if (!result.success) {
      toast.error(result.error, { duration: 7000 });
      return;
    }
    toast.success("העמוד נמחק");
    router.push("/tours/packages");
    router.refresh();
  };

  const siteUrl = saved.siteUrl;
  const liveUrl = saved.form.isActive ? siteAssetUrl(siteUrl, `/package/${saved.form.slug}/`) : null;
  const selectedTerms = new Set(form.termIds);
  const toggleTerm = (id: string, on: boolean) =>
    set("termIds", on ? [...form.termIds, id] : form.termIds.filter((t) => t !== id));

  return (
    <div dir="rtl" className="space-y-4 pb-24">
      <BackLink href="/tours/packages">כל עמודי הטיולים</BackLink>
      <PageHeader
        eyebrow="עמוד טיול"
        title={saved.form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={saved.form.isActive ? "on" : "off"}>{saved.form.isActive ? "פעיל באתר" : "לא פעיל"}</Pill>
            {!saved.hasContent && <Pill>ללא תוכן</Pill>}
            {saved.seriesCodes.length > 0 && (
              <span>
                סדרות:{" "}
                <span dir="ltr" className="font-mono">
                  {saved.seriesCodes.join(", ")}
                </span>
              </span>
            )}
            <span>{saved.departures} יציאות</span>
          </span>
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

      {!saved.hasContent && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            העמוד הזה נוצר בטעינת הנתונים כדי שלסדרה יהיה עמוד, ואין בו עדיין תוכן. אחרי שמזינים תיאור או תמונה ושומרים
            הוא נחשב עמוד עם תוכן. כדי שיופיע באתר צריך גם לסמן אותו כפעיל ולפרסם.
          </p>
        </div>
      )}

      <UrlTabs defaultValue="general" values={TABS} dir="rtl" className="space-y-4">
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
              <Field label="שם העמוד">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="כותרת משנה">
                <Input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
              </Field>
              <Field
                label="כתובת העמוד (slug)"
                hint={
                  saved.slugLocked
                    ? "לעמוד יש יציאות, ולכן הכתובת שלו באתר נעולה."
                    : "החלק האחרון של כתובת העמוד באתר. בלי רווחים."
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
              <Field label="סוג">
                <Select value={form.kind} onValueChange={(value) => set("kind", value)}>
                  <SelectTrigger dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {PACKAGE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {PACKAGE_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="צבע הכרטיס באתר">
                <Select value={form.brand} onValueChange={(value) => set("brand", value)}>
                  <SelectTrigger dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
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
              <Field label="ימים">
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={form.days ?? ""}
                  onChange={(e) => set("days", numberOrNull(e.target.value))}
                />
              </Field>
              <Field label="לילות">
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={form.nights ?? ""}
                  onChange={(e) => set("nights", numberOrNull(e.target.value))}
                />
              </Field>
              <Field label="מדינות" hint='כפי שמוצג באתר, למשל "מדינה אחת" או "3 מדינות"'>
                <Input value={form.countries} onChange={(e) => set("countries", e.target.value)} />
              </Field>
              <div className="flex items-center gap-3 self-end rounded-md border p-3">
                <Switch id="pkg-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
                <label htmlFor="pkg-active" className="text-sm">
                  <span className="font-medium">פעיל באתר</span>
                  <span className="block text-xs text-muted-foreground">עמוד לא פעיל לא נכלל בבניית האתר.</span>
                </label>
              </div>
            </div>
            <StringListEditor
              label="עונות"
              value={form.seasons}
              onChange={(value) => set("seasons", value)}
              placeholder="קיץ, חנוכה, פסח..."
              addLabel="הוספת עונה"
            />
          </Section>

          <Section title="מחיקת העמוד" description="מחיקה רכה: העמוד יוצא מהרשימות ומהאתר, והנתונים נשמרים.">
            <Button type="button" variant="outline" className="text-destructive" disabled={isDeleting} onClick={() => void remove()}>
              <Trash2 />
              מחיקת העמוד
            </Button>
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ images */}
        <TabsContent value="images" className="space-y-4">
          <Section description={NO_UPLOAD_NOTE}>
            <div className="grid gap-4 lg:grid-cols-2">
              <ImageUrlField
                label="תמונה ראשית (ראש העמוד)"
                value={form.heroImage}
                onChange={(value) => set("heroImage", value)}
                siteUrl={siteUrl}
              />
              <ImageUrlField
                label="תמונת כרטיס (ברשימות)"
                value={form.cardImage}
                onChange={(value) => set("cardImage", value)}
                siteUrl={siteUrl}
              />
            </div>
          </Section>
          <Section>
            <ImageListEditor
              label="גלריה"
              value={form.gallery}
              onChange={(value) => set("gallery", value)}
              siteUrl={siteUrl}
              hint="הסדר כאן הוא הסדר באתר."
            />
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ description */}
        <TabsContent value="description" className="space-y-4">
          <Section>
            <HtmlField
              label="תיאור הטיול"
              value={form.descriptionHtml}
              onChange={(value) => set("descriptionHtml", value)}
              siteUrl={siteUrl}
            />
          </Section>
          <Section>
            <StringListEditor
              label="אטרקציות"
              value={form.attractions}
              onChange={(value) => set("attractions", value)}
              addLabel="הוספת אטרקציה"
            />
          </Section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Section>
              <StringListEditor
                label="המחיר כולל"
                value={form.included}
                onChange={(value) => set("included", value)}
              />
            </Section>
            <Section>
              <StringListEditor
                label="המחיר אינו כולל"
                value={form.notIncluded}
                onChange={(value) => set("notIncluded", value)}
              />
            </Section>
          </div>
          <Section>
            <HtmlField
              label="מידע נוסף"
              value={form.extraInfoHtml}
              onChange={(value) => set("extraInfoHtml", value)}
              siteUrl={siteUrl}
              rows={8}
              hint="רשימה פשוטה (ul / li) מוצגת באתר כנקודות. HTML אחר מוצג כפי שהוא."
            />
          </Section>
          <Section>
            <HtmlField
              label="תנאי הזמנה"
              value={form.termsHtml}
              onChange={(value) => set("termsHtml", value)}
              siteUrl={siteUrl}
              rows={8}
            />
          </Section>
          <Section>
            <HtmlField
              label="תנאי ביטול"
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
              אין שאלות נפוצות בעמוד הזה.
            </p>
          )}
          {form.faq.map((item, index) => (
            <Section key={index}>
              <div className="flex items-start gap-2">
                <Field label={`שאלה ${index + 1}`} className="min-w-0 flex-1">
                  <Input
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
                    removeLabel="הסרת השאלה"
                  />
                </div>
              </div>
              <HtmlField
                label="תשובה"
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
            הוספת שאלה
          </Button>
        </TabsContent>

        {/* ------------------------------------------------------------ seo */}
        <TabsContent value="seo">
          <Section description="מה שמנועי החיפוש והרשתות החברתיות מציגים על העמוד.">
            <Field label="כותרת (title)" hint={`${form.seoTitle.length} תווים. מומלץ עד 60.`}>
              <Input value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
            </Field>
            <Field label="תיאור (description)" hint={`${form.seoDescription.length} תווים. מומלץ עד 160.`}>
              <Textarea rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
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
                      {!term.isActive && <span className="text-xs text-muted-foreground">(לא פעיל)</span>}
                    </label>
                  ))}
                </div>
              </Section>
            );
          })}
        </TabsContent>
      </UrlTabs>

      <ContentSaveBar isDirty={isDirty} isSaving={isSaving} onSave={() => void save()} onDiscard={discard} disabledReason={problem} />
    </div>
  );
}
