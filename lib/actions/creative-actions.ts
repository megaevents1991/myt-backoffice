"use server";

import {
  renderAndUploadCreative,
  deriveCreativeDefaults,
} from "@/lib/creative/auto";
import { buildCreativeInput, type CreativeParams } from "@/lib/creative/input";
import { SIZES } from "@/lib/creative/render";
import { updateEvent } from "./event-actions";
import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";

// Auth-guarded wrappers for the designer UI. All derivation/render/upload
// logic lives in lib/creative/auto.ts, shared with the nightly campaign cron.

export type { CreativeDefaults } from "@/lib/creative/auto";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function generateCreative(
  params: CreativeParams & { attachEventId?: number | null },
): Promise<{ squareUrl: string; bannerUrl: string }> {
  await requireStaff();
  const input = await buildCreativeInput(params);
  // Hebrew names slugify to "" - fall back to ids/date so files never collide.
  const dateSlug = params.dateText.replace(/\./g, "-");
  const slug =
    params.kind === "artist"
      ? `${slugify(input.homeName) || "artist"}-${dateSlug}`
      : params.kind === "photo"
        ? `${slugify(input.homeName) || "event"}-${dateSlug}`
        : `${slugify(input.homeName) || params.homeRef.replace(":", "-")}-vs-${slugify(input.awayName ?? "") || params.awayRef.replace(":", "-")}-${dateSlug}`;

  const urls = await renderAndUploadCreative(input, slug);

  if (params.attachEventId) {
    try {
      await updateEvent(params.attachEventId, { card_image_url: urls.square });
    } catch (error) {
      console.error(JSON.stringify(error));
      throw new Error("Creative saved, but attaching to event failed");
    }
    await revalidateMain();
  }

  await logAudit({
    action: "create",
    entityType: "creative",
    entityId: params.attachEventId ?? null,
    metadata: { kind: params.kind, sizes: Object.keys(SIZES) },
  });

  return { squareUrl: urls.square, bannerUrl: urls.banner };
}

export async function getCreativeDefaults(eventId: number) {
  await requireStaff();
  return deriveCreativeDefaults(eventId);
}
