"use client";

import { useEffect, useMemo, useState } from "react";
import { Bookmark, Eye, Heart, ImageOff, MessageCircle, Share2, type LucideIcon } from "lucide-react";

import { useSessionState } from "@/hooks/use-view-state";
import { getInstagramFeed } from "@/lib/actions/marketing-actions";
import { engagementOf, viralPostIds } from "@/lib/marketing/engagement";
import type { IgMediaRow } from "@/types/marketing.types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorText } from "./marketing-shared";

const SORTS = ["engagement", "reach", "date"] as const;
type Sort = (typeof SORTS)[number];
const SORT_LABEL: Record<Sort, string> = { engagement: "Engagement", reach: "Reach", date: "Date" };
const isSort = (v: unknown): v is Sort => typeof v === "string" && (SORTS as readonly string[]).includes(v);

type Feed = Awaited<ReturnType<typeof getInstagramFeed>>;

/** The CDN links Instagram hands out expire - a dead one shows a neutral block, not a broken image. */
function Thumb({ media }: { media: IgMediaRow }) {
  const src = media.thumbnail_url ?? media.media_url ?? "";
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-square w-full bg-muted">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className="aspect-square w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-6 w-6" aria-label="Image not available" />
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, title, value }: { icon: LucideIcon; title: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={title}>
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="sr-only">{title}</span>
      {value.toLocaleString("en-US")}
    </span>
  );
}

function PostCard({ media, viral }: { media: IgMediaRow; viral: boolean }) {
  const body = (
    <>
      <Thumb media={media} />
      <div className="space-y-2 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{media.media_product_type ?? media.media_type ?? "—"}</Badge>
          {viral && <Badge>Viral</Badge>}
          <span className="ms-auto whitespace-nowrap text-muted-foreground">
            {media.posted_at ? new Date(media.posted_at).toLocaleDateString("en-GB") : "—"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stat icon={Eye} title="Reach" value={media.reach} />
          <Stat icon={Heart} title="Likes" value={media.like_count} />
          <Stat icon={MessageCircle} title="Comments" value={media.comments_count} />
          <Stat icon={Bookmark} title="Saves" value={media.saved} />
          <Stat icon={Share2} title="Shares" value={media.shares} />
        </div>
      </div>
    </>
  );
  return (
    <Card className="overflow-hidden">
      {media.permalink ? (
        <a href={media.permalink} target="_blank" rel="noreferrer" className="block hover:bg-muted/40">
          {body}
        </a>
      ) : (
        body
      )}
    </Card>
  );
}

/** Sort control, follower count and the grid. Data in, so it can be rendered without a load. */
export function InstagramView({ feed }: { feed: Feed }) {
  const [sort, setSort] = useSessionState<Sort>("ig-sort", "date", isSort);

  // The alert's own rule and threshold (lib/marketing/engagement.ts), so the badge and the alert never disagree.
  const viral = useMemo(() => viralPostIds(feed.media, feed.viralPct, new Date()), [feed]);
  const sorted = useMemo(() => {
    const byDate = (m: IgMediaRow) => (m.posted_at ? Date.parse(m.posted_at) : 0);
    const key: Record<Sort, (m: IgMediaRow) => number> = {
      engagement: engagementOf,
      reach: (m) => m.reach,
      date: byDate,
    };
    return [...feed.media].sort((a, b) => key[sort](b) - key[sort](a));
  }, [feed, sort]);

  const followers = feed.followers[feed.followers.length - 1]?.followers ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                {SORT_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-medium">
          Followers: <span dir="ltr">{followers === null ? "—" : followers.toLocaleString("en-US")}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {sorted.length} post{sorted.length === 1 ? "" : "s"}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No posts yet. They appear after the first sync.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {sorted.map((m) => (
            <PostCard key={m.id} media={m} viral={viral.has(m.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InstagramTab() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const result = await getInstagramFeed();
        if (!cancelled) setFeed(result);
      } catch (e) {
        console.error("Error loading the Instagram feed:", e);
        if (!cancelled) setError(errorText(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!feed) return <Skeleton className="h-64 w-full" />;
  return <InstagramView feed={feed} />;
}
