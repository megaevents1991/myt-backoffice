"use server";

/**
 * Image upload of a tours company's site content (Mega Family).
 *
 * The editor picks a file; this action checks it, mints a one-time signed
 * upload URL into the company's public bucket `media-<slug>` with the service
 * role, and answers the permanent public URL the site will load the picture
 * from. The bytes then go straight from the browser to Storage
 * (uploadToSignedUrl, like lib/upload-helper.ts) - never through a Vercel
 * function, so the 4.5 MB body limit does not apply. The bucket has no storage
 * policies: nothing but such a signed URL can write into it.
 *
 * The URL lands in the content row only when the editor saves the page; an
 * upload that is never saved stays in the bucket unused.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { requireCompany } from "@/lib/company";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { actionFail, dbFail, plainFail, type ActionResult } from "@/lib/tours/action-kit";
import { companyAudit, invalidInput } from "@/lib/tours/company-kit";
import {
  TOUR_MEDIA_FOLDERS,
  TOUR_MEDIA_MAX_BYTES,
  TOUR_MEDIA_TYPES_LABEL,
  isTourMediaType,
  tourMediaBucket,
  tourMediaPath,
  TOUR_MEDIA_LIST_LIMIT,
  walkTourMedia,
  type TourMediaFile,
  type TourMediaFolder,
  type TourMediaUpload,
} from "@/lib/tours/media";

const SCOPE = "tours-media-actions";

/** Storage answers one folder level per call, up to this many entries. */
const LIST_PAGE = 1000;

/**
 * Every picture of the active company's media bucket, newest first - the media
 * library and the "Library" button of the image fields. The bucket is laid out
 * as `<folder>/<yyyy>/<mm>/<file>`; Storage lists one level per call, so the
 * walk goes folder -> year -> month. Only the company's own bucket is read.
 */
export async function listTourMedia(): Promise<ActionResult<{ files: TourMediaFile[]; truncated: boolean }>> {
  try {
    const { company } = await requireCompany("tours");
    const bucket = tourMediaBucket(company.slug);
    const storage = supabase.storage.from(bucket);
    const list = async (prefix: string) => {
      const { data, error } = await storage.list(prefix, { limit: LIST_PAGE, sortBy: { column: "name", order: "desc" } });
      if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
      return data ?? [];
    };
    const files = await walkTourMedia(list, (path) => storage.getPublicUrl(path).data.publicUrl);
    return { success: true, data: { files: files.slice(0, TOUR_MEDIA_LIST_LIMIT), truncated: files.length > TOUR_MEDIA_LIST_LIMIT } };
  } catch (e) {
    return actionFail(e, SCOPE, "Could not read the media library. Try again.");
  }
}

const uploadSchema = z.object({
  folder: z.enum(TOUR_MEDIA_FOLDERS),
  fileName: z.string().max(500),
  contentType: z.string().refine(isTourMediaType, `Only ${TOUR_MEDIA_TYPES_LABEL} images can be uploaded`),
  size: z
    .number()
    .int()
    .positive("The file is empty")
    .max(TOUR_MEDIA_MAX_BYTES, `An image can be up to ${TOUR_MEDIA_MAX_BYTES / 1024 / 1024} MB`),
});

/** Where to upload one image of the active tours company, and the URL it will have. */
export async function createTourMediaUpload(input: {
  folder: TourMediaFolder;
  fileName: string;
  contentType: string;
  size: number;
}): Promise<ActionResult<TourMediaUpload>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const { folder, fileName, contentType, size } = parsed.data;

    const bucket = tourMediaBucket(company.slug);
    const path = tourMediaPath({
      folder,
      fileName,
      contentType,
      now: new Date(),
      random: randomBytes(4).toString("hex"),
    });

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      if (error && /not.?found/i.test(error.message)) {
        console.error(`${SCOPE}: bucket ${bucket} is missing`, JSON.stringify(error));
        return plainFail(`Image upload is not set up for this company yet (Storage bucket "${bucket}" is missing). Contact support.`);
      }
      return dbFail(SCOPE, "createSignedUploadUrl", error);
    }
    const publicUrl = supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl;

    // Recorded when the upload is granted; the bytes follow from the browser.
    await logAudit({
      action: "create",
      entityType: "tours_media",
      entityId: `${bucket}/${data.path}`,
      metadata: { ...companyAudit(company), folder, file_name: fileName, content_type: contentType, size },
    });

    return { success: true, data: { bucket, path: data.path, token: data.token, publicUrl } };
  } catch (e) {
    return actionFail(e, SCOPE, "Could not prepare the upload. Try again.");
  }
}
