"use client";

/**
 * "Additional info" of a tour as points, like Included (Alon, 07.10.2026):
 * Add Item, one line per point. The value stays the HTML the site reads - a
 * plain <ul><li> list, which it draws as bullets. A text that is not a plain
 * list (imported from WordPress, or written as HTML) keeps its HTML editor,
 * with one button that turns it into points.
 */
import { List } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { StringListEditor } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { htmlOfPoints, pointsFromAnyHtml, pointsOfHtml } from "@/components/tours/content/shared";

export function PointsField({
  label,
  value,
  onChange,
  siteUrl,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  siteUrl: string | null;
}) {
  const confirm = useConfirm();
  const points = pointsOfHtml(value);

  if (points) {
    return (
      <StringListEditor
        label={label}
        value={points}
        onChange={(next) => onChange(htmlOfPoints(next))}
        hint="Each item is one bullet point on the site, like Included."
      />
    );
  }

  const toPoints = async () => {
    const next = pointsFromAnyHtml(value);
    const ok = await confirm({
      title: "Turn this text into a list of points?",
      description: `Every paragraph and line becomes one point (${next.length} here). Bold, links and other formatting are dropped. Nothing is saved until you save the page.`,
      confirmLabel: "Turn into points",
      cancelLabel: "Cancel",
    });
    if (ok) onChange(htmlOfPoints(next));
  };

  return (
    <div className="space-y-2">
      <HtmlField
        label={label}
        value={value}
        onChange={onChange}
        siteUrl={siteUrl}
        rows={8}
        hint="This text is not a plain list, so it is edited as it is and shown on the site as it is."
      />
      <Button type="button" variant="outline" size="sm" onClick={() => void toPoints()}>
        <List />
        Turn into a list of points
      </Button>
    </div>
  );
}
