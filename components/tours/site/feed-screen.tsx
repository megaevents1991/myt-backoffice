"use client";

/**
 * Website > Product Feed (mega-family docs/plans/PRODUCT-FEED-PLAN.md, 08.11.2026): the company's Meta catalog feed.
 * The address to register in Commerce Manager, what the last publish sent (each tour with its picture, price, date and
 * labels), the tours left out with what is missing and what to do, the worlds' feed covers (lib/creative/worlds.ts - the
 * picture over a Collection ad of a world's tours), and "Sync now" - draw the missing pictures, then publish. The crons
 * do the same by themselves: pictures every hour, the feed six times a day.
 */
import { useState, useTransition } from "react";
import { Check, Copy, Download, ExternalLink, ImageIcon, Loader2, Pencil, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Chip, EmptyLine, Fact, FactList, Ltr, Notice, Section } from "@/components/tours/ui";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtInstant } from "@/lib/tours/format";
import { syncToursFeedNow, type FeedScreenData } from "@/lib/actions/tours-feed-actions";

const REASON: Record<string, string> = {
  "no-price": "No open, priced date",
  waitlist: "Waiting list only",
  "no-image": "No picture",
};

export function FeedScreen({ initial }: { initial: FeedScreenData }) {
  const [data, setData] = useState(initial);
  const [syncing, startSync] = useTransition();
  const [copied, setCopied] = useState(false);
  const [copiedCover, setCopiedCover] = useState("");
  const run = useActionToast();
  const p = data.published;

  const syncNow = () =>
    startSync(async () => {
      const result = await run(() => syncToursFeedNow(), (r) => (r.data.result.ok ? `Published: ${r.data.result.items} tours` : "Done"));
      if (result.success) setData(result.data.screen);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.feedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the address stays selectable */
    }
  };

  const copyCover = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCover(key);
      window.setTimeout(() => setCopiedCover(""), 1500);
    } catch {
      /* the links stay usable */
    }
  };

  const editor = (slug: string) => (data.editors[slug] ? `/tours/packages/${data.editors[slug]}` : null);
  const actionable = (p?.skipped ?? []).filter((s) => s.why.actionable);
  const onPurpose = (p?.skipped ?? []).filter((s) => !s.why.actionable);
  const branded = p ? Object.values(p.images).filter((i) => i.branded).length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Feed"
        description="The tours this company's Meta catalog gets: one item per tour, the price the site's card prints, live dates, branded pictures."
        actions={
          <>
            <Button variant="outline" asChild disabled={!p}>
              <a href={data.feedUrl} download>
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </a>
            </Button>
            <Button onClick={syncNow} disabled={syncing || !data.company.siteUrl}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sync now
            </Button>
          </>
        }
      />

      {!data.company.siteUrl && <Notice tone="error">The company has no site address (Settings), so there is no feed to publish.</Notice>}
      {data.analytics.pixel && data.analytics.gtm && (
        <Notice tone="warning">
          Both a Meta Pixel and a GTM container are set in Settings. The site sends the pixel&apos;s events itself - if the GTM container also
          holds the Meta pixel, every event is counted twice.
        </Notice>
      )}

      <Section title="The address for Meta" description="Commerce Manager > the catalog (type: Activities) > Data Sources > Scheduled Feed, refreshed hourly.">
        <div className="flex flex-wrap items-center gap-2">
          <Ltr className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{data.feedUrl}</Ltr>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {p ? (
          <FactList>
            <Fact label="Published">{fmtInstant(p.publishedAt)}</Fact>
            <Fact label="Site build">{p.siteBuiltAt ? fmtInstant(p.siteBuiltAt) : "-"}</Fact>
            <Fact label="In the feed">{p.items.length}</Fact>
            <Fact label="Branded pictures">
              {branded} / {p.items.length}
            </Fact>
            <Fact label="Left out">{p.skipped.length}</Fact>
          </FactList>
        ) : (
          <Notice tone="info">Nothing published yet. Sync now publishes the feed; the cron does it six times a day.</Notice>
        )}
        {p && !p.live && (
          <Notice tone="warning">
            The site could not read the live dates at the last publish, so the feed went out with the dates of its last build. The next run reads
            them again.
          </Notice>
        )}
        <p className="text-xs text-muted-foreground">
          Names, pictures and new tours reach the feed after Publish to site; prices and dates are read live at every publish. A tour without
          its branded picture goes out with its own photo until the hourly run draws it.
        </p>
      </Section>

      {p && (p.worlds ?? []).length > 0 && (
        <Section
          title={`World covers (${(p.worlds ?? []).length})`}
          description="One picture per world, drawn from the world's first hero image (Categories & Tags > Worlds). Use it as the cover of a Collection or catalog ad whose product set is the world's tours: custom_label_0 is the world's key. 4:5 for the feed, 1.91:1 for a collection cover."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(p.worlds ?? []).map((w) => {
              const cover = p.covers?.[w.key];
              return (
                <div key={w.key} className="flex gap-3 rounded-md border p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover?.square || w.image} alt="" className="h-28 w-[5.6rem] shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-medium" dir="auto">
                      {w.brandName} <span className="text-muted-foreground">· {w.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Chip tone="outline">
                        custom_label_0 = <Ltr className="ml-1 font-mono">{w.key}</Ltr>
                      </Chip>
                      <Chip tone={w.tours > 0 ? "muted" : "warning"}>{w.tours} in the feed</Chip>
                      {!cover && <Chip tone="warning">Not drawn yet</Chip>}
                    </div>
                    {cover && (
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <a href={cover.square} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-1 h-3.5 w-3.5" />
                            4:5
                          </a>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <a href={cover.banner} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-1 h-3.5 w-3.5" />
                            1.91:1
                          </a>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => copyCover(w.key, cover.stableSquare)} title="The 4:5 cover's address - it stays the same when the cover is redrawn">
                          {copiedCover === w.key ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                          {copiedCover === w.key ? "Copied" : "Link"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            A world with no tour in the feed still gets a cover; its ad would have no products until one of its tours is priced. A new hero picture
            reaches the cover after Publish to site and the next Sync now (or the hourly run).
          </p>
        </Section>
      )}

      {p && (
        <Section title={`In the feed (${p.items.length})`}>
          {p.items.length === 0 ? (
            <EmptyLine>No tour can be sold online right now - see the tours left out below.</EmptyLine>
          ) : (
            <div className="divide-y rounded-md border">
              {p.items.map((it) => {
                const img = p.images[it.id];
                const edit = editor(it.slug);
                return (
                  <div key={it.id} className="flex flex-wrap items-center gap-3 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img?.image || it.image} alt="" className="h-20 w-16 shrink-0 rounded object-cover" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-medium" dir="auto">
                        {it.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Ltr>{it.price}</Ltr>
                        <span>·</span>
                        <Ltr>{it.activity_date}</Ltr>
                        <span>·</span>
                        <Ltr>{it.id}</Ltr>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {it.imageFrom === "world" && (
                          <Chip tone="info" title="The tour has no photo of its own, so it goes out with its world's first hero picture">
                            World picture
                          </Chip>
                        )}
                        {img?.branded ? (
                          <Chip tone="success">Branded picture</Chip>
                        ) : (
                          <Chip tone="warning">
                            <ImageIcon className="mr-1 h-3 w-3" />
                            Own photo for now
                          </Chip>
                        )}
                        {it.labels.filter(Boolean).map((l, i) => (
                          <Chip key={i} tone="outline">
                            {l}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" asChild>
                        <a href={it.link} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          Site
                        </a>
                      </Button>
                      {edit && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={edit}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {p && p.skipped.length > 0 && (
        <Section title={`Left out (${p.skipped.length})`} description="Tours on the site that the feed does not carry, and what gets each one in.">
          <div className="divide-y rounded-md border">
            {[...actionable, ...onPurpose].map((s) => {
              const edit = editor(s.slug);
              return (
                <div key={s.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {s.name}
                      </span>
                      <Chip tone={s.why.actionable ? "warning" : "muted"}>{REASON[s.reason] ?? s.reason}</Chip>
                    </div>
                    <p dir="rtl" className="text-right">
                      <span className="font-medium">מה חסר: </span>
                      {s.why.missing}
                    </p>
                    <p dir="rtl" className="text-right text-muted-foreground">
                      <span className="font-medium">מה עושים: </span>
                      {s.why.fix}
                    </p>
                  </div>
                  {edit && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={edit}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </a>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
