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

import type { BlogPost } from "@/types/blog.types";
import { richDocToText, textToRichDoc } from "@/lib/richtext";
import { ArtBlobPicker } from "@/components/art-blob-picker";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { createBlogPost, updateBlogPost, uploadBlogImage } from "@/lib/actions/blog-actions";

const autoSlug = (...parts: (string | undefined)[]): string => {
  for (const p of parts) {
    const s = (p || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (s) return s;
  }
  return "post-" + Math.random().toString(36).slice(2, 8);
};

const schema = z.object({
  title: z.string().min(1, "Title is required."),
  name: z.string().optional(),
  slug: z.string().optional(),
  preview_text: z.string().optional(),
  by_who: z.string().optional(),
  main_content: z.string().optional(),
  seo_title_tag: z.string().optional(),
  meta_description: z.string().optional(),
  meta_tags: z.string().optional(),
  display_order: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});
type FormData = z.infer<typeof schema>;

export function BlogForm({ initial }: { initial?: BlogPost }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [artImageUrl, setArtImageUrl] = useState(initial?.art_image_url ?? "");
  const [artColorIndex, setArtColorIndex] = useState(initial?.art_color_index ?? 0);
  const [artShapeIndex, setArtShapeIndex] = useState(initial?.art_shape_index ?? 0);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? "",
      name: initial?.name ?? "",
      slug: initial?.slug ?? "",
      preview_text: initial?.preview_text ?? "",
      by_who: initial?.by_who ?? "",
      main_content: initial?.main_content ? richDocToText(initial.main_content) : "",
      seo_title_tag: initial?.seo_title_tag ?? "",
      meta_description: initial?.meta_description ?? "",
      meta_tags: initial?.meta_tags ?? "",
      display_order: initial?.display_order ?? 0,
      is_active: initial?.is_active ?? true,
    },
  });

  // non-RHF state (image + art) needs its own dirty tracking
  const initialExtras = JSON.stringify({
    imageUrl: initial?.image_url ?? "",
    artImageUrl: initial?.art_image_url ?? "",
    artColorIndex: initial?.art_color_index ?? 0,
    artShapeIndex: initial?.art_shape_index ?? 0,
  });
  const isDirty =
    form.formState.isDirty ||
    JSON.stringify({ imageUrl, artImageUrl, artColorIndex, artShapeIndex }) !==
      initialExtras;

  const resetExtras = () => {
    setImageUrl(initial?.image_url ?? "");
    setArtImageUrl(initial?.art_image_url ?? "");
    setArtColorIndex(initial?.art_color_index ?? 0);
    setArtShapeIndex(initial?.art_shape_index ?? 0);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setImageUrl(await uploadBlogImage(fd));
      toast.success("Image uploaded.");
    } catch (err) {
      toast.error((err as Error)?.message || "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  function onSubmit(values: FormData) {
    startTransition(async () => {
      try {
        const payload = {
          slug: values.slug?.trim() || autoSlug(values.title, values.name),
          name: values.name || values.title,
          title: values.title || null,
          preview_text: values.preview_text || null,
          by_who: values.by_who || null,
          image_url: imageUrl || null,
          image_width: initial?.image_width ?? null,
          image_height: initial?.image_height ?? null,
          art_image_url: artImageUrl || null,
          art_color_index: artImageUrl ? artColorIndex : null,
          art_shape_index: artImageUrl ? artShapeIndex : null,
          main_content: values.main_content ? textToRichDoc(values.main_content) : null,
          seo_title_tag: values.seo_title_tag || null,
          meta_description: values.meta_description || null,
          meta_tags: values.meta_tags || null,
          display_order: values.display_order,
          is_active: values.is_active,
        };
        if (initial) await updateBlogPost(initial.id, payload);
        else await createBlogPost(payload);
        toast.success("Blog post saved!");
        router.push("/templates/blog");
        router.refresh();
      } catch (error) {
        toast.error((error as Error)?.message || "Failed to save.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField control={form.control} name="title" render={({ field }) => (
            <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="slug" render={({ field }) => (
            <FormItem><FormLabel>Slug (optional)</FormLabel><FormControl><Input placeholder="auto from title" {...field} /></FormControl><FormDescription>Leave blank to auto-generate.</FormDescription><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="by_who" render={({ field }) => (
            <FormItem><FormLabel>Author</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="display_order" render={({ field }) => (
            <FormItem><FormLabel>Display order</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="preview_text" render={({ field }) => (
            <FormItem className="md:col-span-2"><FormLabel>Preview text</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="main_content" render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>Body</FormLabel>
              <FormControl><Textarea rows={10} {...field} /></FormControl>
              <FormDescription>Plain paragraphs (blank line between).</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="seo_title_tag" render={({ field }) => (
            <FormItem><FormLabel>SEO title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="meta_tags" render={({ field }) => (
            <FormItem><FormLabel>Meta tags</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="meta_description" render={({ field }) => (
            <FormItem className="md:col-span-2"><FormLabel>Meta description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Hero image</label>
          <Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
          {uploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
          {imageUrl && (
            <Image src={imageUrl} alt="preview" width={240} height={135} className="mt-2 h-[135px] w-60 rounded-lg object-cover" />
          )}
        </div>

        <div className="rounded-lg border p-4">
          <ArtBlobPicker
            label="Post art — cut-out + blob (optional)"
            imageUrl={artImageUrl}
            colorIndex={artColorIndex}
            shapeIndex={artShapeIndex}
            onImage={setArtImageUrl}
            onColor={setArtColorIndex}
            onShape={setArtShapeIndex}
          />
        </div>

        <FormField control={form.control} name="is_active" render={({ field }) => (
          <FormItem className="flex items-center gap-2 space-y-0">
            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            <FormLabel className="!mt-0">Active (visible on the site)</FormLabel>
          </FormItem>
        )} />

        <Button type="submit" disabled={isPending || uploading}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </form>

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isPending}
        onSave={form.handleSubmit(onSubmit)}
        onDiscard={() => {
          form.reset();
          resetExtras();
        }}
        disabled={uploading}
      />
    </Form>
  );
}
