"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X } from "lucide-react";
import { uploadToBucket } from "@/lib/upload-helper";
import { getPublicUrl } from "@/lib/actions/storage-actions";

// Meta rejects catalog videos over 200 MB; the feed also drops anything that
// isn't a direct file URL (YouTube/Instagram player links never work).
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * events.campaign_video_url editor: paste a direct file URL, or upload a
 * video straight to the `campaign_videos` bucket (signed-URL client upload -
 * bytes skip the Vercel 4.5 MB body limit) and get the public URL filled in.
 */
export function CampaignVideoField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      setError("הקובץ גדול מ-200MB - מטא דוחה וידאו כזה בפיד");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Unique name so a re-upload never collides with an existing object.
      const safeName = file.name.replace(/[^\w.-]+/g, "-");
      const named = new File([file], `${Date.now()}-${safeName}`, {
        type: file.type,
      });
      const path = await uploadToBucket("campaign_videos", "", named);
      onChange(await getPublicUrl("campaign_videos", path));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="campaign_video_url">Campaign Video URL (Meta feed)</Label>
      <div className="flex gap-2">
        <Input
          id="campaign_video_url"
          value={value ?? ""}
          placeholder="https://….supabase.co/storage/v1/object/public/campaign_videos/ariana-london.mp4"
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span className="ml-2">העלה וידאו</span>
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="נקה"
            onClick={() => onChange("")}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Direct link to a video FILE (.mp4, .mov, …), max 200 MB - upload here (goes
        to the campaign_videos bucket) or paste a public URL. YouTube/Instagram
        player links do NOT work and are dropped from the feed.
      </p>
    </div>
  );
}
