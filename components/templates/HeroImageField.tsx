"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";

import { Input } from "@/components/ui/input";
import { ImageFilePicker } from "@/components/image-file-picker";
import { uploadToBucket } from "@/lib/upload-helper";
import { getPublicUrl } from "@/lib/actions/storage-actions";

const TEMPLATE_BUCKET = "templates";

/**
 * Hero/banner image field for the Template forms (artists, football, blog,
 * categories). Uploads go straight from the browser to Supabase Storage via a
 * signed URL (uploadToBucket) — the old server-action upload died on any file
 * over the 1 MB action body limit (4.5 MB on Vercel), which made existing
 * images impossible to replace. ImageFilePicker adds URL editing, browsing the
 * bucket, and clearing the field to remove the image.
 */
export function HeroImageField({
  label = "Hero image",
  value,
  onChange,
  onUploadingChange,
}: {
  label?: string;
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const setBusy = (busy: boolean) => {
    setUploading(busy);
    onUploadingChange?.(busy);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const renamed = new File([file], `${Date.now()}-${safeName}`, {
        type: file.type,
      });
      const storedPath = await uploadToBucket(TEMPLATE_BUCKET, "", renamed);
      onChange(await getPublicUrl(TEMPLATE_BUCKET, storedPath));
      toast.success("Image uploaded.");
    } catch (err) {
      toast.error((err as Error)?.message || "Image upload failed.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <ImageFilePicker
        value={value}
        onChange={onChange}
        label={label}
        bucketName={TEMPLATE_BUCKET}
      />
      <Input
        type="file"
        accept="image/*"
        onChange={handleFile}
        disabled={uploading}
      />
      <p className="text-xs text-muted-foreground">
        {uploading
          ? "Uploading…"
          : "Pick a file to upload and replace, paste a URL above, or clear the URL to remove."}
      </p>
    </div>
  );
}
