"use client";

/**
 * The home page of the company's site as a list of sections: reorder, hide,
 * edit, add and remove. One Save for the whole page; the site shows it after
 * Revalidate Pages.
 *
 * Two people on the page at once (Liz + Alon, 12.11.2026): the editor asks every half minute,
 * and when its tab comes back, whether someone else saved, and says so at once. Their save is
 * merged into what is on screen (lib/tours/home-merge.ts) - by the banner's button, or by itself
 * when a Save is refused - so nobody has to type their changes again; the merged page waits on
 * screen for a look and a Save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Button } from "@/components/ui/button";
import { Notice, Section } from "@/components/tours/ui";
import { FooterTilesField, pruneTiles } from "@/components/tours/site/site-fields";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import { useActionToast } from "@/hooks/use-action-toast";
import { deepEqual, type MergeCollision } from "@/lib/doc-merge";
import {
  getSiteDoc,
  getSiteDocVersion,
  saveSiteDoc,
  type SiteDocEditorData,
  type SiteDocVersion,
  type SiteEditorOptions,
} from "@/lib/actions/tours-site-actions";
import { fmtInstant } from "@/lib/tours/format";
import { collisionLine, mergeHomeDocs } from "@/lib/tours/home-merge";
import { homeSchema, type HomeDoc } from "@/lib/tours/site-content";
import { SectionsBoard, sectionsProblem } from "@/components/tours/site/sections-board";
import type { ActionResult } from "@/components/tours/content/shared";

type HomeData = SiteDocEditorData<"home">;

/** How often an open editor asks whether someone else saved the page. */
const STALE_CHECK_MS = 30_000;

/** The document as it is saved: tiles nobody filled in are dropped. */
const cleaned = (form: HomeDoc): HomeDoc => ({ ...form, footerTiles: { ...form.footerTiles, items: pruneTiles(form.footerTiles.items) } });

const whoOf = (by: string | null) => by || "Someone";
const whenOf = (at: string | null) => (at ? fmtInstant(at) : "");

/** Another person's save, merged into what is on screen and not saved yet. */
interface MergedNote {
  by: string | null;
  at: string | null;
  collisions: MergeCollision[];
}

export function HomepageEditor({ initial, options }: { initial: HomeData; options: SiteEditorOptions }) {
  const run = useActionToast();
  // the version the next save must name; it moves with every successful save and every merge
  const version = useRef(initial.updatedAt);
  const [stale, setStale] = useState<SiteDocVersion | null>(null);
  const [merged, setMerged] = useState<MergedNote | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  // the form hook's own "this moment" readers, filled in right after it is made (the save below needs them)
  const formApi = useRef<{ current: () => { saved: HomeData; form: HomeDoc }; rebase: (saved: HomeData, form: HomeDoc) => void } | null>(null);
  const busy = useRef(false);

  /**
   * Puts `latest` under what is on screen: my changes since my last save, merged onto it. Answers whether
   * anything of mine is left to save.
   */
  const catchUp = useCallback((latest: HomeData): boolean => {
    const api = formApi.current;
    if (!api) return false;
    const { saved, form } = api.current();
    const result = mergeHomeDocs(saved.form, form, latest.form);
    version.current = latest.updatedAt;
    api.rebase(latest, result.value);
    setStale(null);
    const mineLeft = !deepEqual(result.value, latest.form);
    setMerged(mineLeft ? { by: latest.updatedBy, at: latest.updatedAt, collisions: result.collisions } : null);
    return mineLeft;
  }, []);

  const save = useCallback(
    async (form: HomeDoc): Promise<ActionResult<HomeData>> => {
      const result = await saveSiteDoc("home", cleaned(form), version.current);
      if (result.success) {
        version.current = result.data.updatedAt;
        setStale(null);
        setMerged(null);
        return result as ActionResult<HomeData>;
      }
      if (!("latest" in result) || result.latest.key !== "home") return result;
      // someone else saved first: their save comes in under my changes, which stay on screen
      const latest = result.latest as HomeData;
      if (!catchUp(latest)) return { success: true, data: latest }; // their save already holds everything I had
      return {
        success: false,
        error: `Not saved yet: ${whoOf(latest.updatedBy)} saved this page at ${whenOf(latest.updatedAt)} while you were editing. Their changes are now on your page together with yours - look it over and Save again.`,
      };
    },
    [catchUp],
  );
  const { saved, form, set, isDirty, isSaving, submit, discard, current, rebase } = useContentForm<HomeDoc, HomeData>(initial, save);
  formApi.current = { current, rebase };
  busy.current = isSaving || catchingUp;

  // has someone else saved since this copy was loaded? Asked every half minute while the tab is shown, and when it comes back
  useEffect(() => {
    let alive = true;
    let asking = false;
    const check = async () => {
      if (asking || busy.current || document.visibilityState !== "visible") return;
      asking = true;
      const asked = version.current;
      try {
        const answer = await getSiteDocVersion("home");
        // a save or a merge that moved the version meanwhile answers for itself
        if (!alive || !answer.success || busy.current || version.current !== asked) return;
        setStale(answer.data.updatedAt !== asked ? answer.data : null);
      } finally {
        asking = false;
      }
    };
    const onShown = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = window.setInterval(() => void check(), STALE_CHECK_MS);
    window.addEventListener("focus", onShown);
    document.addEventListener("visibilitychange", onShown);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onShown);
      document.removeEventListener("visibilitychange", onShown);
    };
  }, []);

  /** The banner's button: the newest save comes in under what is on screen (nothing of mine = just the newest copy). */
  const bringIn = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setCatchingUp(true);
    try {
      const answer = await run(() => getSiteDoc("home"));
      if (answer.success && answer.data.key === "home") catchUp(answer.data as HomeData);
    } finally {
      setCatchingUp(false);
    }
  }, [catchUp, run]);

  const sections = form.sections;
  // the category tiles of the Tour finder: a section can be shown for some of them only
  const tiles = useMemo(
    () => sections.flatMap((section) => (section.type === "tours" ? section.tabs.map((tab) => ({ key: tab.key, label: tab.label || "(no name)" })) : [])),
    [sections],
  );

  // what the server would refuse, said before the click
  const problem = useMemo(() => {
    const inSection = sectionsProblem(sections);
    if (inSection) return inSection;
    const parsed = homeSchema.safeParse(cleaned(form));
    return parsed.success ? null : parsed.error.issues[0].message;
  }, [form, sections]);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title="Homepage"
        description="The sections of the site's home page, top to bottom. Move a section, hide it, open it to edit, or add a new one. Save, then Revalidate Pages to show the change on the site."
        actions={
          <>
            <ViewOnSiteButton href={saved.siteUrl} />
            <PublishSiteButton />
          </>
        }
      />

      {(stale || (merged && isDirty)) && (
        // kept in view under the top bar: people edit deep inside the Tour finder, far below the top of the page
        <div className="sticky top-12 z-10 space-y-2 bg-background pb-1 pt-2">
          {stale && <StaleNotice stale={stale} dirty={isDirty} busy={catchingUp || isSaving} onBringIn={() => void bringIn()} />}
          {merged && isDirty && <MergedNotice note={merged} onClose={() => setMerged(null)} />}
        </div>
      )}

      {sections.length === 0 && (
        <Notice tone="warning">The home page has no sections. Add the first one below; until then the site shows its built-in home page.</Notice>
      )}

      <SectionsBoard sections={sections} onChange={(next) => set("sections", next)} options={options} siteUrl={saved.siteUrl} tiles={tiles} />

      <Section title="Tiles above the footer" description="What the home page shows above the footer.">
        <FooterTilesField value={form.footerTiles} onChange={(footerTiles) => set("footerTiles", footerTiles)} options={options} siteUrl={saved.siteUrl} />
      </Section>
      {saved.updatedBy && <p className="text-sm text-muted-foreground">Last saved by {saved.updatedBy}</p>}

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isSaving || catchingUp}
        onSave={() => void submit()}
        onDiscard={() => {
          discard();
          setMerged(null);
        }}
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message={CONTENT_UNSAVED_NOTE}
      />
    </div>
  );
}

/** Someone else saved after this copy was loaded. */
function StaleNotice({ stale, dirty, busy, onBringIn }: { stale: SiteDocVersion; dirty: boolean; busy: boolean; onBringIn: () => void }) {
  const who = whoOf(stale.updatedBy);
  const when = whenOf(stale.updatedAt);
  return (
    <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-3">
      <span>
        {dirty
          ? `${who} saved this page at ${when}, after you opened it. Bring their changes in before you go on - yours stay on the page, and your Save will not be refused.`
          : `${who} saved this page at ${when}. You are looking at an older copy.`}
      </span>
      <Button size="sm" onClick={onBringIn} disabled={busy}>
        {dirty ? "Bring their changes in" : "Load the newest"}
      </Button>
    </Notice>
  );
}

/** What a merge did: whose save came in, and where both people changed the same thing. */
function MergedNotice({ note, onClose }: { note: MergedNote; onClose: () => void }) {
  const who = whoOf(note.by);
  return (
    <Notice tone={note.collisions.length ? "warning" : "info"} className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <p>
          {who}&apos;s save of {whenOf(note.at)} is now on your page, together with your changes. Nothing is saved yet: look it over and Save.
        </p>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onClose} aria-label="Close">
          ×
        </Button>
      </div>
      {note.collisions.length > 0 && (
        <>
          <p className="font-medium">Check these - you both touched them:</p>
          <ul className="max-h-40 list-disc overflow-y-auto ps-5">
            {note.collisions.map((collision, i) => (
              <li key={i}>{collisionLine(collision, who)}</li>
            ))}
          </ul>
        </>
      )}
    </Notice>
  );
}
