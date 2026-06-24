"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Image from "next/image";
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

import {
  createCategory,
  uploadCategoryImage,
} from "@/lib/actions/category-actions";

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
      display_order: 0,
      is_active: true,
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setImageUrl(await uploadCategoryImage(fd));
      toast.success("Image uploaded.");
    } catch (err) {
      toast.error((err as Error)?.message || "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  async function onSubmit(values: CategoryFormData) {
    startTransition(async () => {
      try {
        await createCategory({
          slug: values.slug?.trim() || autoSlug(values.name_english, values.name),
          name: values.name,
          name_english: values.name_english || null,
          image_url: imageUrl || null,
          display_order: values.display_order,
          is_active: values.is_active,
          subtitle: values.subtitle || null,
          tag: values.tag || null,
          sport: values.sport || null,
          link_url: values.link_url || null,
          member_ids: parseMemberIds(membersRaw),
        });
        toast.success("Category created!");
        router.push("/templates/categories");
        router.refresh();
      } catch (error) {
        toast.error((error as Error)?.message || "Failed to create category.");
      }
    });
  }

  return (
    <div className="container mx-auto py-10 max-w-3xl">
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Banner image</label>
            <Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
            {uploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
            {imageUrl && (
              <Image src={imageUrl} alt="Banner preview" width={320} height={160} className="mt-2 h-40 w-80 rounded-lg object-cover" />
            )}
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

          <FormField control={form.control} name="is_active" render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="!mt-0">Active (visible on the site)</FormLabel>
            </FormItem>
          )} />

          <Button type="submit" disabled={isPending || uploading} className="mt-4">
            {isPending ? "Creating..." : "Create Category"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
