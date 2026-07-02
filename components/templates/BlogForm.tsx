"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { HeroImageField } from "@/components/templates/HeroImageField";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { createBlogPost, updateBlogPost } from "@/lib/actions/blog-actions";

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
  const [artImageScale, setArtImageScale] = useState(initial?.art_image_scale ?? 1);
  const [artBgScale, setArtBgScale] = useState(initial?.art_bg_scale ?? 1);
  const [artImageOffsetX, setArtImageOffsetX] = useState(initial?.art_image_offset_x ?? 0);
  const [artImageOffsetY, setArtImageOffsetY] = useState(initial?.art_image_offset_y ?? 0);

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
    artImageScale: initial?.art_image_scale ?? 1,
    artBgScale: initial?.art_bg_scale ?? 1,
    artImageOffsetX: initial?.art_image_offset_x ?? 0,
    artImageOffsetY: initial?.art_image_offset_y ?? 0,
  });
  const isDirty =
    form.formState.isDirty ||
    JSON.stringify({
      imageUrl,
      artImageUrl,
      artColorIndex,
      artShapeIndex,
      artImageScale,
      artBgScale,
      artImageOffsetX,
      artImageOffsetY,
    }) !== initialExtras;

  const resetExtras = () => {
    setImageUrl(initial?.image_url ?? "");
    setArtImageUrl(initial?.art_image_url ?? "");
    setArtColorIndex(initial?.art_color_index ?? 0);
    setArtShapeIndex(initial?.art_shape_index ?? 0);
    setArtImageScale(initial?.art_image_scale ?? 1);
    setArtBgScale(initial?.art_bg_scale ?? 1);
    setArtImageOffsetX(initial?.art_image_offset_x ?? 0);
    setArtImageOffsetY(initial?.art_image_offset_y ?? 0);
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
          art_image_scale: artImageUrl ? artImageScale : null,
          art_bg_scale: artImageUrl ? artBgScale : null,
          art_image_offset_x: artImageUrl ? artImageOffsetX : null,
          art_image_offset_y: artImageUrl ? artImageOffsetY : null,
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

        <HeroImageField
          value={imageUrl}
          onChange={setImageUrl}
          onUploadingChange={setUploading}
        />

        <div className="rounded-lg border p-4">
          <ArtBlobPicker
            label="Post art — cut-out + blob (optional)"
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
