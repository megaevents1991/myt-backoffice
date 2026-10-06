"use client";

/**
 * The company's Google reviews, inside the Reviews section of the home page
 * editor: what the mirror holds, when it was last read, a button to read it now,
 * and a switch per review to keep it off the site.
 *
 * Unlike the rest of the editor, a switch here saves at once: it changes the
 * review itself (public.google_reviews.is_hidden), not the home page document.
 */
import { useEffect, useState } from "react";
import { RefreshCw, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyLine, Notice } from "@/components/tours/ui";
import {
  getCompanyGoogleReviews,
  refreshCompanyGoogleReviews,
  setCompanyGoogleReviewHidden,
  type CompanyGoogleReviews,
} from "@/lib/actions/tours-reviews-actions";

const day = (iso: string | null): string => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");

export function GoogleReviewsPanel({ minRating, limit }: { minRating: number; limit: number }) {
  const [mirror, setMirror] = useState<CompanyGoogleReviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getCompanyGoogleReviews().then((result) => {
      if (!alive) return;
      if (result.success) setMirror(result.data);
      else setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    const result = await refreshCompanyGoogleReviews();
    if (result.success) setMirror(result.data);
    else setError(result.error);
    setBusy(false);
  };

  const setHidden = async (key: string, hidden: boolean) => {
    setSaving(key);
    setError(null);
    const result = await setCompanyGoogleReviewHidden(key, hidden);
    if (result.success) setMirror((current) => (current ? { ...current, reviews: current.reviews.map((r) => (r.key === key ? { ...r, hidden } : r)) } : current));
    else setError(result.error);
    setSaving(null);
  };

  if (!mirror) return error ? <Notice tone="warning">{error}</Notice> : <EmptyLine>Loading the Google reviews…</EmptyLine>;

  if (!mirror.placeId) {
    return (
      <Notice tone="warning">
        The company has no Google profile set yet. Enter its Google Place ID in Header & Footer &gt; Contact details; the reviews are then read every night. Until
        then the site shows the reviews typed here.
      </Notice>
    );
  }

  // what the site will draw: with a text, not hidden, with enough stars - newest first, up to the limit
  const eligible = mirror.reviews.filter((r) => !r.hidden && r.text.trim() !== "" && r.rating >= minRating);
  const onSite = new Set(eligible.slice(0, limit).map((r) => r.key));

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p dir="auto" className="font-medium">
            {mirror.name || "Google profile"}
          </p>
          <p className="text-muted-foreground">
            {mirror.reviews.length} reviews mirrored
            {mirror.rating != null ? ` · rating ${mirror.rating}` : ""}
            {mirror.syncedAt ? ` · last read ${day(mirror.syncedAt)}` : " · not read yet"}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          {busy ? "Reading…" : "Refresh from Google"}
        </Button>
      </div>

      {error && <Notice tone="warning">{error}</Notice>}
      {mirror.syncError && <Notice tone="warning">The last nightly read reported a problem: {mirror.syncError}</Notice>}

      {mirror.reviews.length === 0 ? (
        <EmptyLine>No reviews mirrored yet. Click Refresh from Google. Until there are any, the site shows the reviews typed here.</EmptyLine>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The site shows the {onSite.size} newest reviews that have a text and at least {minRating} stars. Switch a review off to keep it away from the site;
            the switch saves at once, and the site follows after the next Revalidate Pages.
          </p>
          <ul className="max-h-[420px] space-y-2 overflow-y-auto pe-1">
            {mirror.reviews.map((review) => (
              <li key={review.key} className="flex items-start gap-3 rounded-md border bg-background p-2">
                <Switch
                  checked={!review.hidden}
                  disabled={saving === review.key}
                  onCheckedChange={(on) => void setHidden(review.key, !on)}
                  aria-label={`Show the review of ${review.name} on the site`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span dir="auto" className="font-medium">
                      {review.name}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground" title={`${review.rating} of 5 stars`}>
                      {review.rating}
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </span>
                    <span className="text-muted-foreground">{day(review.date)}</span>
                    {onSite.has(review.key) && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">On the site</span>}
                    {review.hidden && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Hidden</span>}
                  </p>
                  <p dir="auto" className="line-clamp-2 text-muted-foreground">
                    {review.text || "(no text - the site skips it)"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
