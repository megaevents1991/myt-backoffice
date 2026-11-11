"use client";

/**
 * The Content tab of a departure card (Alon 10.11, road map tab "בק אופיס לידים והזמנות" note 5): what THIS date says
 * instead of the tour page - description, attractions, included / not included, top picture, gallery. Each field the
 * date leaves empty shows what the site shows instead: its season's when the season fills it, else the tour's.
 * "Edit for this date" copies that text in to change. Saved in data.ownContent (lib/tours/departure-content.ts); the
 * day-by-day plan stays the General tab's "Itinerary version". "Copy to other dates" (Liz 11.11: "שיהיה אפשר לבחור יותר
 * מטיסה אחת כדי לשנות") saves this date and writes the fields ticked there to the tour's other dates ticked there.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, CopyCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionToast } from "@/hooks/use-action-toast";
import { copyDepartureContent, getDepartureContent, saveDepartureContent } from "@/lib/actions/tours-departure-content-actions";
import { attractionLabel } from "@/lib/tours/attractions";
import {
  CONTENT_FIELDS,
  filled,
  inheritedField,
  type ContentField,
  type ContentSibling,
  type DepartureContentData,
  type DepartureContentForm,
} from "@/lib/tours/departure-content";
import { Notice, Section } from "@/components/tours/ui";
import { ImageListEditor, ImageUrlField, SiteImage, StringListEditor } from "@/components/tours/content/fields";
import { AttractionsEditor } from "@/components/tours/content/attractions-editor";
import { HtmlField } from "@/components/tours/content/html-field";
import type { DepartureCardData } from "./types";

const LABELS: Record<ContentField, string> = {
  descriptionHtml: "Description",
  attractions: "Attractions",
  included: "Included",
  notIncluded: "Not included",
  heroImage: "Top picture",
  gallery: "Images",
};

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
};

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const listBody = (items: string[]) =>
  items.length ? (
    <ul className="list-disc space-y-0.5 ps-5" dir="auto">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  ) : (
    <p>Empty.</p>
  );

export function CardContentTab({ data }: { data: DepartureCardData }) {
  const runAction = useActionToast();
  const departureId = data.departure.id;
  const [content, setContent] = useState<DepartureContentData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<DepartureContentForm | null>(null);
  const [busy, setBusy] = useState(false);
  // fields opened for this date: their editor stays while they are empty (a field the season and the tour leave empty
  // too, or one cleared while typing - review 10.11)
  const [opened, setOpened] = useState<Set<ContentField>>(() => new Set());
  // "Copy to other dates": the dates ticked, and the fields ticked (null = the fields this date fills)
  const [copyTo, setCopyTo] = useState<Set<string>>(() => new Set());
  const [copyFields, setCopyFields] = useState<Set<ContentField> | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await getDepartureContent(departureId);
      if (!live) return;
      if (!answer.success) {
        setFailed(answer.error);
        return;
      }
      setContent(answer.data);
      setDraft(answer.data.own);
    })();
    return () => {
      live = false;
    };
  }, [departureId]);

  const dirty = useMemo(() => !!content && !!draft && JSON.stringify(draft) !== JSON.stringify(content.own), [content, draft]);

  if (failed) return <Notice tone="error">{failed}</Notice>;
  if (!content || !draft) {
    return (
      <div className="space-y-3 pt-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const set = <K extends ContentField>(key: K, value: DepartureContentForm[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const own = CONTENT_FIELDS.filter((k) => filled(draft, k));
  const source = (from: "season" | "tour") => (from === "season" && content.season ? `the season's (${content.season.name})` : "the tour's");

  /** A field this date leaves empty: what the site shows instead, and a way to change it for this date. */
  const inherited = (key: ContentField, preview: (value: DepartureContentForm[ContentField]) => ReactNode) => {
    if (filled(draft, key) || opened.has(key)) return null;
    const { from, value } = inheritedField(content, key);
    return (
      <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3" data-inherited={key}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {LABELS[key]} <span className="font-normal text-muted-foreground">- {source(from)}, shown on this date</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setOpened((current) => new Set(current).add(key));
              set(key, structuredClone(value) as never);
            }}
          >
            <Copy />
            Edit for this date
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">{preview(value)}</div>
      </div>
    );
  };

  const save = async () => {
    setBusy(true);
    const answer = await runAction(() => saveDepartureContent(departureId, draft));
    setBusy(false);
    if (!answer.success) return;
    setContent(answer.data);
    setDraft(answer.data.own);
    setOpened(new Set());
  };

  const fields = copyFields ?? new Set(own);
  const chosen = content.siblings.filter((d) => copyTo.has(d.id));
  // a ticked date that already says a ticked field of its own: it is replaced
  const replaced = chosen.filter((d) => d.own.some((k) => fields.has(k)));
  const copy = async () => {
    setBusy(true);
    const answer = await runAction(() => copyDepartureContent(departureId, draft, [...copyTo], [...fields]));
    setBusy(false);
    if (!answer.success) return;
    setContent(answer.data);
    setDraft(answer.data.own);
    setOpened(new Set());
    setCopyTo(new Set());
    setCopyFields(null);
  };
  const tick = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  const sameSeason = (d: ContentSibling) => !!content.season && d.season === content.season.name;

  return (
    <div className="space-y-4 pb-24">
      <Section
        title={`What ${content.code} says instead of the tour page`}
        description={
          own.length
            ? `This date has its own ${own.map((k) => LABELS[k].toLowerCase()).join(", ")}. Every field left empty shows its season's, else the tour's.`
            : `Everything here is optional. The site shows this date's own field first, then ${content.season ? `its season's (${content.season.name})` : "its season's (it has none)"}, then the tour's. Fill only what is different on this date.`
        }
      >
        {inherited("descriptionHtml", (v) => <p dir="auto" className="line-clamp-4 whitespace-pre-line">{textOf(v as string) || "Empty."}</p>) ?? (
          <HtmlField
            label="Description (empty = the season's, else the tour's)"
            value={draft.descriptionHtml}
            onChange={(value) => set("descriptionHtml", value)}
            siteUrl={content.siteUrl}
            rows={8}
          />
        )}
        {inherited("attractions", (v) => listBody((v as string[]).map(attractionLabel))) ?? (
          <AttractionsEditor label="Attractions (empty = the season's, else the tour's)" value={draft.attractions} onChange={(value) => set("attractions", value)} />
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {inherited("included", (v) => listBody(v as string[])) ?? (
            <StringListEditor label="Included (empty = the season's, else the tour's)" value={draft.included} onChange={(value) => set("included", value)} />
          )}
          {inherited("notIncluded", (v) => listBody(v as string[])) ?? (
            <StringListEditor label="Not included (empty = the season's, else the tour's)" value={draft.notIncluded} onChange={(value) => set("notIncluded", value)} />
          )}
        </div>
        <ImageUrlField
          label="Top picture of this date (empty = the season's, else the tour's)"
          value={draft.heroImage}
          onChange={(value) => set("heroImage", value)}
          siteUrl={content.siteUrl}
          folder="packages"
          hint="The wide picture at the top of the tour page while a customer has this date chosen."
        />
        {inherited("gallery", (v) => (
          <div className="flex flex-wrap gap-1.5">
            {(v as string[]).slice(0, 8).map((src, i) => (
              <SiteImage key={i} siteUrl={content.siteUrl} path={src} className="h-12 w-16" />
            ))}
            {(v as string[]).length > 8 && <span className="self-center text-xs">+{(v as string[]).length - 8}</span>}
            {(v as string[]).length === 0 && <span>Empty.</span>}
          </div>
        )) ?? (
          <ImageListEditor
            label="Images - the gallery of this date (empty = the season's, else the tour's)"
            value={draft.gallery}
            onChange={(value) => set("gallery", value)}
            siteUrl={content.siteUrl}
            folder="packages"
          />
        )}
      </Section>

      {content.siblings.length > 0 && (
        <Section
          title="Copy to other dates"
          description={`The same content on other dates of this tour: tick the fields and the dates, then copy. This date is saved too. On each ticked date a ticked field becomes ${content.code}'s (an empty one goes back to its season's / the tour's); its other fields stay its own.`}
        >
          <div className="space-y-2">
            <p className="text-sm font-medium">Fields</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {CONTENT_FIELDS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={fields.has(key)}
                    onCheckedChange={(on) => {
                      const next = new Set(fields);
                      if (on === true) next.add(key);
                      else next.delete(key);
                      setCopyFields(next);
                    }}
                  />
                  {LABELS[key]}
                  {!filled(draft, key) && <span className="text-xs text-muted-foreground">(empty here)</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="me-auto text-sm font-medium">
                Dates <span className="font-normal text-muted-foreground">- the ones that have not left yet</span>
              </p>
              {content.season && content.siblings.some(sameSeason) && (
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setCopyTo(new Set(content.siblings.filter(sameSeason).map((d) => d.id)))}>
                  Season {content.season.name}
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setCopyTo(new Set(content.siblings.map((d) => d.id)))}>
                All {content.siblings.length}
              </Button>
              {copyTo.size > 0 && (
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setCopyTo(new Set())}>
                  None
                </Button>
              )}
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {content.siblings.map((d) => (
                <li key={d.id}>
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                    <Checkbox checked={copyTo.has(d.id)} onCheckedChange={(on) => setCopyTo((current) => tick(current, d.id, on === true))} />
                    <span className="font-mono font-medium">{d.code}</span>
                    <span className="text-muted-foreground" dir="ltr">
                      {shortDate(d.startDate)} - {shortDate(d.endDate)}
                    </span>
                    {d.season && <span className="text-xs text-muted-foreground">· {d.season}</span>}
                    {d.own.length > 0 && (
                      <span className="ms-auto text-xs text-amber-700 dark:text-amber-400" title={`Has its own ${d.own.map((k) => LABELS[k].toLowerCase()).join(", ")}`}>
                        own {d.own.map((k) => LABELS[k].toLowerCase()).join(", ")}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {replaced.length > 0 && (
            <Notice tone="warning">
              {replaced.map((d) => `${d.code} (${d.own.filter((k) => fields.has(k)).map((k) => LABELS[k].toLowerCase()).join(", ")})`).join(", ")}: what{" "}
              {replaced.length === 1 ? "it says" : "they say"} of {replaced.length === 1 ? "its" : "their"} own in the ticked fields is replaced.
            </Notice>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={() => void copy()} disabled={busy || copyTo.size === 0 || fields.size === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyCheck />}
              {dirty ? "Save and copy" : "Copy"} to {copyTo.size === 0 ? "the ticked dates" : copyTo.size === 1 ? "1 date" : `${copyTo.size} dates`}
            </Button>
          </div>
        </Section>
      )}

      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
        <span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes in this date's content" : "No changes"}</span>
        <div className="ms-auto flex gap-2">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(content.own);
                setOpened(new Set());
              }}
              disabled={busy}
            >
              Discard
            </Button>
          )}
          <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
