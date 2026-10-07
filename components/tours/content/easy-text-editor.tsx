"use client";

/**
 * The text of an imported page, without its HTML (lib/tours/wp-html.ts): one
 * text for a legal page, an opening text and topics for a FAQ page. The page
 * keeps the layout the site draws it with; only its words are edited here.
 */
import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EmptyLine, Field, Notice, Section } from "@/components/tours/ui";
import { ImageUrlField, RowControls, moved } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import type { EasyLayout, EasyText } from "@/lib/tours/wp-html";

const LAYOUT_NOTES: Record<EasyLayout, string> = {
  legal: "This page came with the site. Its text is edited here like any text: headings, lists, links, bold. The page keeps its look.",
  faq: "This page came with the site. Edit its opening text and its topics here; each topic opens on the site when a customer clicks its title.",
  faq_home: "This page came with the site. Edit its heading and its opening text here; the tiles to the FAQ pages under them are part of the page.",
  about:
    "This page came with the site. Edit its heading, its text and the picture beside the text here. The row of links to the other \"about\" pages and the tiles under the text are part of the page.",
  contact:
    "This page came with the site. Edit its two headings and its opening text here. The phone, the address and the opening hours under the form are set in Header & Footer > Contact details.",
  form_page: "This page came with the site. Edit the text above the form and the text under it here. The form itself is part of the page.",
  blog: "This page lists the blog posts by itself, newest first. Edit its heading and its opening lines here. Each post is edited on its own screen (Blog posts, on the list of Content Pages).",
  leaders:
    "This page lists the group leaders by itself; each leader is edited in Tours > Group Leaders. Edit the line under the page title, and the closing heading and text, here.",
};

type Topic = EasyText["faq"][number];

/** The topics of a FAQ page: one row per topic, opened one at a time (each holds a long text). */
function TopicsEditor({ topics, onChange, siteUrl }: { topics: Topic[]; onChange: (topics: Topic[]) => void; siteUrl: string | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (index: number, change: Partial<Topic>) => onChange(topics.map((topic, i) => (i === index ? { ...topic, ...change } : topic)));
  const move = (index: number, delta: -1 | 1) => {
    onChange(moved(topics, index, delta));
    // the open topic follows its row
    if (open === index) setOpen(index + delta);
    else if (open === index + delta) setOpen(index);
  };
  return (
    <div className="space-y-2">
      {topics.length === 0 && <EmptyLine>No topics yet.</EmptyLine>}
      <ol className="space-y-2">
        {topics.map((topic, index) => {
          const isOpen = open === index;
          return (
            <li key={index} className="rounded-md border bg-background">
              <div className="flex items-center gap-2 p-2">
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
                <button type="button" onClick={() => setOpen(isOpen ? null : index)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  <span dir="auto" className={cn("min-w-0 truncate text-sm font-medium", !topic.q.trim() && "text-muted-foreground")}>
                    {topic.q.trim() || "(no title yet)"}
                  </span>
                </button>
                <RowControls
                  index={index}
                  count={topics.length}
                  onMove={(delta) => move(index, delta)}
                  onRemove={() => {
                    onChange(topics.filter((_, i) => i !== index));
                    setOpen(null);
                  }}
                />
              </div>
              {isOpen && (
                <div className="space-y-3 border-t p-3">
                  <Field label="Topic title" hint="What the customer clicks to open the topic. A topic without a title is not saved.">
                    <Input dir="auto" value={topic.q} onChange={(e) => patch(index, { q: e.target.value })} />
                  </Field>
                  <HtmlField
                    label="Text of the topic"
                    value={topic.a}
                    onChange={(a) => patch(index, { a })}
                    siteUrl={siteUrl}
                    rows={14}
                    hint="Write each question in bold, and its answer under it."
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={topics.length >= 60}
        onClick={() => {
          onChange([...topics, { q: "", a: "" }]);
          setOpen(topics.length);
        }}
      >
        <Plus />
        Add Topic
      </Button>
    </div>
  );
}

export function EasyTextEditor({
  layout,
  value,
  onChange,
  siteUrl,
}: {
  layout: EasyLayout;
  value: EasyText;
  onChange: (value: EasyText) => void;
  siteUrl: string | null;
}) {
  return (
    <>
      <Notice tone="info">{LAYOUT_NOTES[layout]}</Notice>
      {layout === "legal" && (
        <Section>
          <HtmlField label="Page text" value={value.body} onChange={(body) => onChange({ ...value, body })} siteUrl={siteUrl} rows={24} />
        </Section>
      )}
      {layout === "faq_home" && (
        <Section>
          <Field label="Heading" className="md:max-w-xl">
            <Input dir="auto" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
          </Field>
          <HtmlField label="Opening text" value={value.intro} onChange={(intro) => onChange({ ...value, intro })} siteUrl={siteUrl} rows={6} />
        </Section>
      )}
      {layout === "faq" && (
        <>
          <Section>
            <HtmlField label="Opening text" value={value.intro} onChange={(intro) => onChange({ ...value, intro })} siteUrl={siteUrl} rows={5} hint="The lines above the topics." />
          </Section>
          <Section title={`Topics (${value.faq.length})`} description="Open a topic to edit its title and its text. The order here is the order on the site.">
            <TopicsEditor topics={value.faq} onChange={(faq) => onChange({ ...value, faq })} siteUrl={siteUrl} />
          </Section>
        </>
      )}
      {layout === "about" && (
        <>
          <Section>
            <Field label="Heading" hint="The bold line above the text." className="md:max-w-xl">
              <Input dir="auto" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
            </Field>
            <HtmlField label="Page text" value={value.body} onChange={(body) => onChange({ ...value, body })} siteUrl={siteUrl} rows={16} />
          </Section>
          <Section title="Picture beside the text" description="Shown next to the text on a computer and under it on a phone.">
            <ImageUrlField label="Picture" value={value.image} onChange={(image) => onChange({ ...value, image })} siteUrl={siteUrl} folder="pages" />
            <Field label="What the picture shows" hint="One short line, read aloud to visitors who cannot see the picture." className="md:max-w-xl">
              <Input dir="auto" value={value.imageAlt} onChange={(e) => onChange({ ...value, imageAlt: e.target.value })} />
            </Field>
          </Section>
        </>
      )}
      {layout === "contact" && (
        <Section>
          <Field label="Heading" className="md:max-w-xl">
            <Input dir="auto" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
          </Field>
          <HtmlField label="Opening text" value={value.intro} onChange={(intro) => onChange({ ...value, intro })} siteUrl={siteUrl} rows={6} hint="The lines between the heading and the form." />
          <Field label="Heading above the form" className="md:max-w-xl">
            <Input dir="auto" value={value.heading2} onChange={(e) => onChange({ ...value, heading2: e.target.value })} />
          </Field>
        </Section>
      )}
      {layout === "form_page" && (
        <Section>
          <HtmlField label="Text above the form" value={value.intro} onChange={(intro) => onChange({ ...value, intro })} siteUrl={siteUrl} rows={8} />
          <HtmlField label="Text under the form" value={value.after} onChange={(after) => onChange({ ...value, after })} siteUrl={siteUrl} rows={6} />
        </Section>
      )}
      {layout === "blog" && (
        <Section>
          <Field label="Heading" className="md:max-w-xl">
            <Input dir="auto" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
          </Field>
          <HtmlField label="Opening lines" value={value.intro} onChange={(intro) => onChange({ ...value, intro })} siteUrl={siteUrl} rows={5} hint="The lines above the posts." />
        </Section>
      )}
      {layout === "leaders" && (
        <Section>
          <Field label="Line under the page title" className="md:max-w-xl">
            <Input dir="auto" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
          </Field>
          <Field label="Closing heading" hint="The heading of the text under the leaders." className="md:max-w-xl">
            <Input dir="auto" value={value.heading2} onChange={(e) => onChange({ ...value, heading2: e.target.value })} />
          </Field>
          <HtmlField label="Closing text" value={value.after} onChange={(after) => onChange({ ...value, after })} siteUrl={siteUrl} rows={12} />
        </Section>
      )}
    </>
  );
}
