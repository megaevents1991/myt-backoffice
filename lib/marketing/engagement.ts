/** Engagement of one Instagram media = likes + comments + saves + shares. Pure; used by the viral rule and the grid's badge. */
export const engagementOf = (m: { like_count: number; comments_count: number; saved: number; shares: number }): number =>
  m.like_count + m.comments_count + m.saved + m.shares;

/** Mean engagement of the up-to-30 posts BEFORE index i (posts sorted oldest first); null with fewer than 5. */
export function baselineBefore<T extends { like_count: number; comments_count: number; saved: number; shares: number }>(posts: T[], i: number): number | null {
  const before = posts.slice(Math.max(0, i - 30), i);
  if (before.length < 5) return null;
  return before.reduce((s, b) => s + engagementOf(b), 0) / before.length;
}
