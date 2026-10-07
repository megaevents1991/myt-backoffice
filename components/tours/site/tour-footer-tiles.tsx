"use client";

/**
 * "Tiles above the footer" for one tour, under the tour's editor. A tour page
 * follows the rule of tour pages (Header & Footer > Footer) until the tour says
 * otherwise here: always show the main tiles, hide them, or show tiles of its own.
 *
 * The card saves by itself (its own button), apart from the tour's Save: the choice
 * lives in the tour's `data`, and the tour form does not carry it.
 */
import { useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/hooks/use-action-toast";
import { EmptyLine, Notice, Section } from "@/components/tours/ui";
import { FooterTilesField, pruneTiles } from "@/components/tours/site/site-fields";
import { getTourFooterTiles, saveTourFooterTiles, type TourFooterTilesData } from "@/lib/actions/tours-site-actions";
import type { FooterTiles } from "@/lib/tours/site-content";

const pruned = (tiles: FooterTiles): FooterTiles => ({ ...tiles, items: pruneTiles(tiles.items) });

export function TourFooterTilesCard({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<TourFooterTilesData | null>(null);
  const [form, setForm] = useState<FooterTiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const run = useActionToast();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // loaded the first time the card opens: most visits to a tour never need it
    if (next && !saved && !error) {
      void getTourFooterTiles(packageId).then((result) => {
        if (result.success) {
          setSaved(result.data);
          setForm(result.data.form);
        } else setError(result.error);
      });
    }
  };

  const isDirty = !!saved && !!form && JSON.stringify(pruned(form)) !== JSON.stringify(pruned(saved.form));
  const save = () => {
    if (!form || isSaving) return;
    startSaving(async () => {
      const result = await run(() => saveTourFooterTiles(packageId, pruned(form)), "Saved. Click Revalidate Pages to update the site.");
      if (result.success) {
        setSaved(result.data);
        setForm(result.data.form);
      }
    });
  };

  return (
    <Section
      title="Tiles above the footer"
      description="What this tour's page shows above the footer. Saved with its own button, apart from the tour."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={toggle} aria-expanded={open}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          {open ? "Close" : "Edit"}
        </Button>
      }
      // sits right under the tour editor (which keeps room for its save bar), and keeps the same room itself
      className="-mt-16 mb-24"
    >
      {open &&
        (error ? (
          <Notice tone="warning">{error}</Notice>
        ) : !saved || !form ? (
          <EmptyLine>Loading…</EmptyLine>
        ) : (
          <div className="space-y-3">
            <Notice tone="info">
              {saved.shownOnTours
                ? "Tour pages show the main tiles today (Header & Footer > Footer). Hide them on this tour, or give it tiles of its own."
                : "Tour pages show no tiles today (Header & Footer > Footer). Show the main tiles on this tour, or give it tiles of its own."}
            </Notice>
            <FooterTilesField value={form} onChange={setForm} options={saved.options} siteUrl={saved.siteUrl} />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={save} disabled={!isDirty || isSaving}>
                {isSaving && <Loader2 className="animate-spin" />}
                Save the tiles
              </Button>
              {isDirty && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm(saved.form)} disabled={isSaving}>
                  Discard
                </Button>
              )}
            </div>
          </div>
        ))}
    </Section>
  );
}
