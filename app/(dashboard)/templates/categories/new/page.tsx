"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { createCategory, getCategories } from "@/lib/actions/category-actions";
import { setCategoryTags } from "@/lib/actions/event-taxonomy-actions";
import { ArtBlobPicker } from "@/components/art-blob-picker";
import { CategoryTagsField } from "@/components/templates/CategoryTagsField";
import { HeroImageField } from "@/components/templates/HeroImageField";
import { StickySaveBar } from "@/components/sticky-save-bar";

const autoSlug = (...parts: (string | undefined)[]): string => {
  for (const p of parts) {
    const s = (p || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (s) return s;
  }
  return "category-" + Math.random().toString(36).slice(2, 8);
};

const categoryFormSchema = z.object({
  name: z.string().min(1, "Name is required."),
  name_english: z.string().optional(),
  slug: z.string().optional(),
  subtitle: z.string().optional(),
  tag: z.string().optional(),
  sport: z.string().optional(),
  link_url: z.string().optional(),
  parent_id: z.string().optional(),
  display_order: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;

const parseMemberIds = (raw: string): string[] =>
  raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

export default function NewCategoryPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [membersRaw, setMembersRaw] = useState("");
  // Which tags compose this category — the whole membership rule (see
  // CategoryTagsField). Saved after the card itself exists.
  const [catTagIds, setCatTagIds] = useState<number[]>([]);
  // Parent options — a category page nests under its parent (/c/sport/football).
  const [parentOptions, setParentOptions] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    getCategories()
      .then((rows) => setParentOptions(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch((e) => console.error("Failed to load parent categories:", e));
  }, []);
  const [artImageUrl, setArtImageUrl] = useState("");
  const [artColorIndex, setArtColorIndex] = useState(0);
  const [artShapeIndex, setArtShapeIndex] = useState(0);
  const [artImageScale, setArtImageScale] = useState(1);
  const [artBgScale, setArtBgScale] = useState(1);
  const [artImageOffsetX, setArtImageOffsetX] = useState(0);
  const [artImageOffsetY, setArtImageOffsetY] = useState(0);

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      name_english: "",
      slug: "",
      subtitle: "",
      tag: "",
      sport: "",
      link_url: "",
      parent_id: "",
      display_order: 0,
      is_active: true,
    },
  });

  // non-RHF state (image, art, members) needs its own dirty tracking
  const isDirty =
    form.formState.isDirty ||
    !!imageUrl ||
    !!artImageUrl ||
    artColorIndex !== 0 ||
    artShapeIndex !== 0 ||
    artImageScale !== 1 ||
    artBgScale !== 1 ||
    artImageOffsetX !== 0 ||
    artImageOffsetY !== 0 ||
    membersRaw.trim() !== "";

  const resetExtras = () => {
    setImageUrl("");
    setArtImageUrl("");
    setArtColorIndex(0);
    setArtShapeIndex(0);
    setArtImageScale(1);
    setArtBgScale(1);
    setArtImageOffsetX(0);
    setArtImageOffsetY(0);
    setMembersRaw("");
    setCatTagIds([]);
  };

  async function onSubmit(values: CategoryFormData) {
    startTransition(async () => {
      try {
        const created = await createCategory({
          slug: values.slug?.trim() || autoSlug(values.name_english, values.name),
          name: values.name,
          name_english: values.name_english || null,
          image_url: imageUrl || null,
          art_image_url: artImageUrl || null,
          art_color_index: artImageUrl ? artColorIndex : null,
          art_shape_index: artImageUrl ? artShapeIndex : null,
          art_image_scale: artImageUrl ? artImageScale : null,
          art_bg_scale: artImageUrl ? artBgScale : null,
          art_image_offset_x: artImageUrl ? artImageOffsetX : null,
          art_image_offset_y: artImageUrl ? artImageOffsetY : null,
          display_order: values.display_order,
          is_active: values.is_active,
          subtitle: values.subtitle || null,
          tag: values.tag || null,
          sport: values.sport || null,
          link_url: values.link_url || null,
          parent_id: values.parent_id ? Number(values.parent_id) : null,
          member_ids: parseMemberIds(membersRaw),
        });
        // Tags ARE the category: every event carrying one lands in it.
        if (catTagIds.length) await setCategoryTags(created.id, catTagIds);
        toast.success("Category created!");
        router.push("/templates/categories");
        router.refresh();
      } catch (error) {
        toast.error((error as Error)?.message || "Failed to create category.");
      }
    });
  }

  return (
    <div className="container mx-auto py-10 pb-28 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Add New Category</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name (Hebrew)</FormLabel>
                <FormControl><Input placeholder="ליגת האלופות" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="name_english" render={({ field }) => (
              <FormItem>
                <FormLabel>Name (English, optional)</FormLabel>
                <FormControl><Input placeholder="Champions League" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="slug" render={({ field }) => (
              <FormItem>
                <FormLabel>Slug (optional)</FormLabel>
                <FormControl><Input placeholder="auto from name (e.g. champions-league)" {...field} /></FormControl>
                <FormDescription>Leave blank to auto-generate. URL: /category/&lt;slug&gt;</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="parent_id" render={({ field }) => (
              <FormItem>
                <FormLabel>קטגוריית אב</FormLabel>
                <FormControl>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                  >
                    <option value="">— ראשית —</option>
                    {parentOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormDescription>
                  קובע את הנתיב של עמוד הקטגוריה: /c/&lt;אב&gt;/&lt;slug&gt;
                </FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="sport" render={({ field }) => (
              <FormItem>
                <FormLabel>Sport / group (optional)</FormLabel>
                <FormControl><Input placeholder="כדורגל" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="subtitle" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Subtitle (optional)</FormLabel>
                <FormControl><Input placeholder="עונת 2025/26 · אירופה · שלב ההכרעה" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="tag" render={({ field }) => (
              <FormItem>
                <FormLabel>Tag / badge (optional)</FormLabel>
                <FormControl><Input placeholder="כרטיסים אחרונים" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="display_order" render={({ field }) => (
              <FormItem>
                <FormLabel>Display order</FormLabel>
                <FormControl><Input type="number" {...field} /></FormControl>
                <FormDescription>Lower shows first.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="link_url" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Override link (optional)</FormLabel>
                <FormControl><Input placeholder="/football  (blank → /category/<slug>)" {...field} /></FormControl>
                <FormDescription>If set, the card links here instead of the category page.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <HeroImageField
            label="Banner image"
            value={imageUrl}
            onChange={setImageUrl}
            onUploadingChange={setUploading}
          />

          <div className="rounded-lg border p-4">
            <ArtBlobPicker
              label="Card art — cut-out + blob (optional)"
              imageUrl={artImageUrl}
              colorIndex={artColorIndex}
              shapeIndex={artShapeIndex}
              imageScale={artImageScale}
              bgScale={artBgScale}
              imageOffsetX={artImageOffsetX}
              imageOffsetY={artImageOffsetY}
              onImage={setArtImageUrl}
              onColor={setArtColorIndex}
              onShape={setArtShapeIndex}
              onImageScale={setArtImageScale}
              onBgScale={setArtBgScale}
              onImageOffsetX={setArtImageOffsetX}
              onImageOffsetY={setArtImageOffsetY}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Member pages (optional)</label>
            <Textarea
              placeholder="Contentful entry IDs of artist/team pages, comma or newline separated"
              value={membersRaw}
              onChange={(e) => setMembersRaw(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">Listed on the category page.</p>
          </div>

          <CategoryTagsField value={catTagIds} onChange={setCatTagIds} />

          <FormField control={form.control} name="is_active" render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="!mt-0">
                פעיל באתר
                <span className="block text-xs font-normal text-muted-foreground">
                  מדליק גם את הכרטיס בדף הבית וגם את עמוד הקטגוריה עצמו (/c/…)
                </span>
              </FormLabel>
            </FormItem>
          )} />

          <Button type="submit" disabled={isPending || uploading} className="mt-4">
            {isPending ? "Creating..." : "Create Category"}
          </Button>
        </form>
      </Form>

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isPending}
        onSave={form.handleSubmit(onSubmit)}
        onDiscard={() => {
          form.reset();
          resetExtras();
        }}
        saveLabel="Create Category"
        savingLabel="Creating..."
        disabled={uploading}
      />
    </div>
  );
}
