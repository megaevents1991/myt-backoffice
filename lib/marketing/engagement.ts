/** How many of the newest `ig_media` rows the grid (getInstagramFeed) and the viral alert both read - one window, so
 *  the badge and the alert judge a post against the same baseline. */
export const IG_MEDIA_READ = 200;

/** Engagement of one Instagram media = likes + comments + saves + shares. Pure; used by the viral rule and the grid's badge. */
export const engagementOf = (m: { like_count: number; comments_count: number; saved: number; shares: number }): number =>
  m.like_count + m.comments_count + m.saved + m.shares;

/** Mean engagement of the up-to-30 posts BEFORE index i (posts sorted oldest first); null with fewer than 5. */
export function baselineBefore<T extends { like_count: number; comments_count: number; saved: number; shares: number }>(posts: T[], i: number): number | null {
  const before = posts.slice(Math.max(0, i - 30), i);
  if (before.length < 5) return null;
  return before.reduce((s, b) => s + engagementOf(b), 0) / before.length;
}

export interface ViralMedia {
  id: string;
  posted_at: string | null;
  like_count: number;
  comments_count: number;
  saved: number;
  shares: number;
  media_product_type: string | null;
}

/**
 * THE viral rule - the alert and the grid's "ויראלי" badge both come from here, so they can never disagree.
 * A post is viral when it is not a STORY, has a `posted_at`, is at least 24 h old (its numbers are still
 * moving before that), has a baseline (`baselineBefore`: the up-to-30 posts before it, oldest first, at least 5)
 * with a mean above zero, and its engagement beats `mean * viralPct / 100`. Oldest first, with the numbers the alert prints.
 */
export function viralPosts<T extends ViralMedia>(media: T[], viralPct: number, now: Date): { media: T; engagement: number; mean: number }[] {
  const posts = media
    .filter((m) => m.posted_at && m.media_product_type !== "STORY")
    .sort((a, b) => ((a.posted_at as string) < (b.posted_at as string) ? -1 : 1));
  const out: { media: T; engagement: number; mean: number }[] = [];
  posts.forEach((m, i) => {
    if (now.getTime() - new Date(m.posted_at as string).getTime() < 24 * 3600e3) return;
    const mean = baselineBefore(posts, i);
    if (mean === null || mean <= 0) return;
    const engagement = engagementOf(m);
    if (engagement > (mean * viralPct) / 100) out.push({ media: m, engagement, mean });
  });
  return out;
}

/** The ids of `viralPosts` - what the Instagram grid marks. */
export const viralPostIds = (media: ViralMedia[], viralPct: number, now: Date): Set<string> =>
  new Set(viralPosts(media, viralPct, now).map((v) => v.media.id));
