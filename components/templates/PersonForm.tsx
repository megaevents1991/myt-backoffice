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

import type { Person, PersonKind } from "@/types/person.types";
import { richDocToText, textToRichDoc } from "@/lib/richtext";
import { ArtBlobPicker } from "@/components/art-blob-picker";
import { StickySaveBar } from "@/components/sticky-save-bar";
import * as artist from "@/lib/actions/artist-actions";
import * as football from "@/lib/actions/football-actions";

// Auto-generate a URL slug (like Contentful's entry id) when left blank:
// slugify the English name, else the name, else a random id.
const autoSlug = (...parts: (string | undefined)[]): string => {
  for (const p of parts) {
    const s = (p || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (s) return s;
  }
  return "item-" + Math.random().toString(36).slice(2, 8);
};

// --- page-enrichment textareas (one item per line) <-> jsonb ----------------
const lines = (s?: string) =>
  (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const parseVideos = (s?: string) =>
  lines(s).map((l) => {
    const [url, label] = l.split("|").map((x) => x.trim());
    return { url, label: label || undefined };
  });
const parseBanners = (s?: string) =>
  lines(s).map((l) => {
    const [image_url, link_url, title] = l.split("|").map((x) => x.trim());
    return { image_url, link_url: link_url || undefined, title: title || undefined };
  });
const galleryText = (g?: string[] | null) => (g ?? []).join("\n");
const videosText = (v?: { url?: string; label?: string }[] | null) =>
  (v ?? []).map((x) => [x.url, x.label].filter(Boolean).join(" | ")).join("\n");
const bannersText = (
  b?: { image_url?: string; link_url?: string; title?: string }[] | null
) => (b ?? []).map((x) => [x.image_url, x.link_url, x.title].filter(Boolean).join(" | ")).join("\n");

const schema = z.object({
  name: z.string().min(1, "Name is required."),
  name_english: z.string().optional(),
  slug: z.string().optional(),
  preview_text: z.string().optional(),
  bio: z.string().optional(),
  seo_title: z.string().optional(),
  meta_description: z.string().optional(),
  meta_tags: z.string().optional(),
  featured_order: z.string().optional(), // "" = not featured
  hero_video_url: z.string().optional(),
  banners: z.string().optional(),
  gallery: z.string().optional(),
  videos: z.string().optional(),
  is_active: z.boolean().default(true),
});
type FormData = z.infer<typeof schema>;

const api = (kind: PersonKind) =>
  kind === "artists"
    ? {
        create: artist.createArtist,
        update: artist.updateArtist,
        upload: artist.uploadArtistImage,
        base: "/templates/artists",
        label: "Artist",
      }
    : {
        create: football.createFootballTeam,
        update: football.updateFootballTeam,
        upload: football.uploadFootballImage,
        base: "/templates/football",
        label: "Team",
      };

export function PersonForm({ kind, initial }: { kind: PersonKind; initial?: Person }) {
  const a = api(kind);
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
      name: initial?.name ?? "",
      name_english: initial?.name_english ?? "",
      slug: initial?.slug ?? "",
      preview_text: initial?.preview_text ?? "",
      bio: initial?.bio ? richDocToText(initial.bio) : "",
      seo_title: initial?.seo_title ?? "",
      meta_description: initial?.meta_description ?? "",
      meta_tags: initial?.meta_tags ?? "",
      featured_order:
        initial?.featured_order != null ? String(initial.featured_order) : "",
      hero_video_url: initial?.hero_video_url ?? "",
      banners: bannersText(initial?.banners),
      gallery: galleryText(initial?.gallery),
      videos: videosText(initial?.videos),
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
      setImageUrl(await a.upload(fd));
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
          slug: values.slug?.trim() || autoSlug(values.name_english, values.name),
          name: values.name,
          name_english: values.name_english || null,
          preview_text: values.preview_text || null,
          image_url: imageUrl || null,
          image_width: initial?.image_width ?? null,
          image_height: initial?.image_height ?? null,
          art_image_url: artImageUrl || null,
          art_color_index: artImageUrl ? artColorIndex : null,
          art_shape_index: artImageUrl ? artShapeIndex : null,
          bio: values.bio ? textToRichDoc(values.bio) : null,
          seo_title: values.seo_title || null,
          meta_description: values.meta_description || null,
          meta_tags: values.meta_tags || null,
          featured_order:
            values.featured_order === "" ? null : Number(values.featured_order),
          hero_video_url: values.hero_video_url || null,
          banners: parseBanners(values.banners),
          gallery: lines(values.gallery),
          videos: parseVideos(values.videos),
          is_active: values.is_active,
        };
        if (initial) await a.update(initial.id, payload);
        else await a.create(payload);
        toast.success(`${a.label} saved!`);
        router.push(a.base);
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
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>Name (Hebrew)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="name_english" render={({ field }) => (
            <FormItem>
              <FormLabel>Name English (events match key)</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormDescription>Must equal the event&apos;s name_english.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="slug" render={({ field }) => (
            <FormItem>
              <FormLabel>Slug (optional)</FormLabel>
              <FormControl><Input placeholder="auto from English name" {...field} /></FormControl>
              <FormDescription>Leave blank to auto-generate. Keep existing when editing.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="featured_order" render={({ field }) => (
            <FormItem>
              <FormLabel>Featured order</FormLabel>
              <FormControl><Input type="number" placeholder="(blank = not in carousel)" {...field} /></FormControl>
              <FormDescription>Lower shows first in the homepage carousel.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="preview_text" render={({ field }) => (
            <FormItem className="md:col-span-2"><FormLabel>Preview text</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="bio" render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>Bio</FormLabel>
              <FormControl><Textarea rows={6} {...field} /></FormControl>
              <FormDescription>Plain paragraphs (blank line between). Existing formatting preserved unless you edit.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="seo_title" render={({ field }) => (
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
            <Image src={imageUrl} alt="preview" width={240} height={160} className="mt-2 h-40 w-60 rounded-lg object-cover" />
          )}
        </div>

        <div className="rounded-lg border p-4">
          <ArtBlobPicker
            label="Card art — cut-out + blob (optional)"
            imageUrl={artImageUrl}
            colorIndex={artColorIndex}
            shapeIndex={artShapeIndex}
            onImage={setArtImageUrl}
            onColor={setArtColorIndex}
            onShape={setArtShapeIndex}
          />
        </div>

        {/* Page extras — artist/team page enrichments (doc 19b/20/21/24) */}
        <div className="space-y-4 rounded-lg border p-4">
          <p className="text-sm font-semibold">Page extras (artist / team page)</p>
          <FormField control={form.control} name="hero_video_url" render={({ field }) => (
            <FormItem>
              <FormLabel>Hero video (YouTube URL)</FormLabel>
              <FormControl><Input placeholder="https://youtu.be/…" {...field} /></FormControl>
              <FormDescription>Loops inside the hero circle instead of the image.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="banners" render={({ field }) => (
            <FormItem>
              <FormLabel>Banners</FormLabel>
              <FormControl><Textarea rows={3} placeholder="image_url | link_url | title" {...field} /></FormControl>
              <FormDescription>One per line: <code>image_url | link_url | title</code> (link &amp; title optional).</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="gallery" render={({ field }) => (
            <FormItem>
              <FormLabel>Gallery images</FormLabel>
              <FormControl><Textarea rows={4} placeholder="https://…/photo.jpg" {...field} /></FormControl>
              <FormDescription>One image URL per line (upload via Hero image above to get a URL).</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="videos" render={({ field }) => (
            <FormItem>
              <FormLabel>Performance videos</FormLabel>
              <FormControl><Textarea rows={3} placeholder="https://youtu.be/… | label" {...field} /></FormControl>
              <FormDescription>One per line: <code>youtube_url | label</code> (label optional).</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
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
