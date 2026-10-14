"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Eye } from "lucide-react";

import { getGoogleAds, getMetaAdPreview, listAdsetAds, type AdRow, type GoogleAdCard } from "@/lib/actions/marketing-ads-actions";
import { META_PREVIEW_FORMATS, META_PREVIEW_LABEL, type MetaPreviewFormat } from "@/lib/marketing/ad-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * The live ad behind a Media row (spec 2026-10-14 section 6). Everything loads on click - nothing rides the table's
 * payload and nothing is stored. Meta: the ad as Meta renders it (an iframe from its previews API, in three
 * formats). Google: the ad's / asset group's own texts and pictures, with its landing page.
 */

type Target =
  | { platform: "meta"; adsetId: string; title: string }
  | { platform: "google"; adGroupId: string; title: string }
  | { platform: "google"; campaignId: string; title: string };

/** The button a Media row carries; opens a side sheet with the ads. */
export function AdsButton({ target, label = "Ads" }: { target: Target; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle dir="auto" className="pe-6">{target.title}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">{open && (target.platform === "meta" ? <MetaAds adsetId={target.adsetId} /> : <GoogleAds target={target} />)}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Failed({ error }: { error: string }) {
  return <p className="text-sm text-destructive">{error}</p>;
}

function MetaAds({ adsetId }: { adsetId: string }) {
  const [ads, setAds] = useState<AdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdsetAds(adsetId).then((r) => {
      if (cancelled) return;
      if (r.ok) setAds(r.ads);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [adsetId]);

  if (error) return <Failed error={error} />;
  if (!ads) return <Skeleton className="h-32 w-full" />;
  if (ads.length === 0) return <p className="text-sm text-muted-foreground">No ads of this ad set were synced yet.</p>;
  return (
    <>
      <ul className="divide-y rounded-md border">
        {ads.map((ad) => (
          <li key={ad.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span dir="auto" className="min-w-0 flex-1 truncate font-medium" title={ad.name}>
              {ad.name || ad.id}
            </span>
            {ad.status && <Badge variant={ad.status === "ACTIVE" ? "secondary" : "outline"}>{ad.status}</Badge>}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setPreview(ad)}>
              Preview
            </Button>
          </li>
        ))}
      </ul>
      <MetaPreviewDialog ad={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function MetaPreviewDialog({ ad, onClose }: { ad: AdRow | null; onClose: () => void }) {
  const [format, setFormat] = useState<MetaPreviewFormat>("MOBILE_FEED_STANDARD");
  const [state, setState] = useState<{ src?: string; error?: string; loading: boolean }>({ loading: false });

  useEffect(() => {
    if (!ad) return;
    let cancelled = false;
    setState({ loading: true });
    getMetaAdPreview(ad.id, format).then((r) => {
      if (cancelled) return;
      setState(r.ok ? { src: r.src, loading: false } : { error: r.error, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [ad, format]);

  const story = format === "INSTAGRAM_STORY";
  return (
    <Dialog open={ad !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle dir="auto" className="truncate pe-6">{ad?.name ?? ""}</DialogTitle>
        </DialogHeader>
        <ToggleGroup type="single" variant="outline" size="sm" value={format} onValueChange={(v) => v && setFormat(v as MetaPreviewFormat)} className="justify-start">
          {META_PREVIEW_FORMATS.map((f) => (
            <ToggleGroupItem key={f} value={f} className="px-3 text-xs">
              {META_PREVIEW_LABEL[f]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex min-h-[420px] justify-center">
          {state.loading ? (
            <Skeleton className="h-[600px] w-[340px]" />
          ) : state.error ? (
            <Failed error={state.error} />
          ) : state.src ? (
            <iframe
              key={state.src}
              src={state.src}
              title={`${ad?.name ?? "Ad"} preview`}
              className="rounded-md border bg-white"
              style={{ width: story ? 340 : 500, height: story ? 600 : 640 }}
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">Rendered by Meta, live - the ad as it runs now.</p>
      </DialogContent>
    </Dialog>
  );
}

function GoogleAds({ target }: { target: Extract<Target, { platform: "google" }> }) {
  const [items, setItems] = useState<GoogleAdCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = "adGroupId" in target ? `ag:${target.adGroupId}` : `c:${target.campaignId}`;

  useEffect(() => {
    let cancelled = false;
    const q = "adGroupId" in target ? { adGroupId: target.adGroupId } : { campaignId: target.campaignId };
    getGoogleAds(q).then((r) => {
      if (cancelled) return;
      if (r.ok) setItems(r.items);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
    // The target is identified by `key`; its object is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) return <Failed error={error} />;
  if (!items) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No live ads here.</p>;
  return (
    <div className="space-y-4">
      {items.map((it) => (
        <div key={it.id} className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{it.kind.replace(/_/g, " ").toLowerCase()}</Badge>
            {it.status && <Badge variant="secondary">{it.status}</Badge>}
            {it.name && (
              <span dir="auto" className="text-sm font-medium">
                {it.name}
              </span>
            )}
          </div>
          {it.images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {it.images.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" loading="lazy" className="h-24 w-auto shrink-0 rounded border object-cover" />
              ))}
            </div>
          )}
          {it.headlines.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Headlines</div>
              <div className="flex flex-wrap gap-1.5">
                {it.headlines.map((h, i) => (
                  <span key={`${h}-${i}`} dir="auto" className="rounded bg-muted px-2 py-0.5 text-xs">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
          {it.descriptions.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descriptions</div>
              <ul className="space-y-1 text-sm">
                {it.descriptions.map((d, i) => (
                  <li key={`${d}-${i}`} dir="auto">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {it.finalUrl && (
            <a href={it.finalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" dir="ltr">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {it.finalUrl}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
