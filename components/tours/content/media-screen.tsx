"use client";

/**
 * /tours/media - the media library of the company's site: every picture that
 * was uploaded from any editor, newest first. Upload here, or copy a picture's
 * address; the image fields open the same library with their "Library" button.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Notice, selectClass } from "@/components/tours/ui";
import { UploadButton } from "@/components/tours/content/fields";
import { MEDIA_FOLDER_LABELS, MediaGrid } from "@/components/tours/content/media-picker";
import { TOUR_MEDIA_FOLDERS, TOUR_MEDIA_LIST_LIMIT, type TourMediaFile, type TourMediaFolder } from "@/lib/tours/media";

export function MediaScreen({ files, truncated }: { files: TourMediaFile[]; truncated: boolean }) {
  const router = useRouter();
  const [folder, setFolder] = useState<TourMediaFolder>("general");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Media"
        description="Every picture uploaded to the site, newest first. Click a picture to copy its address, or use the Library button of any image field to pick one."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Upload to
              <select value={folder} onChange={(event) => setFolder(event.target.value as TourMediaFolder)} className={selectClass} aria-label="Folder to upload to">
                {TOUR_MEDIA_FOLDERS.map((name) => (
                  <option key={name} value={name}>
                    {MEDIA_FOLDER_LABELS[name] ?? name}
                  </option>
                ))}
              </select>
            </label>
            <UploadButton folder={folder} multiple label="Upload Images" savedNote="They are in the library now." onUploaded={() => router.refresh()} />
          </>
        }
      />
      {truncated && <Notice tone="info">Showing the newest {TOUR_MEDIA_LIST_LIMIT.toLocaleString()} pictures.</Notice>}
      <MediaGrid files={files} />
    </div>
  );
}
