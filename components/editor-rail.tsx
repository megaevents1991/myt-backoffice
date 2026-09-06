"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface RailSection {
  id: string;
  label: string;
}

/**
 * Table of contents for the long editors (the event form alone stacks ~37
 * cards). It discovers its own entries from the DOM - any element carrying
 * `id` + `data-editor-section="Label"` becomes a stop - so sections that only
 * render for some event types simply appear and disappear from the rail.
 *
 * Deliberately additive: it does not wrap or reorder the form, so adding it to
 * a screen is one import plus an attribute per section.
 */
export function EditorRail({ className }: { className?: string }) {
  const [sections, setSections] = useState<RailSection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-scan when sections mount or unmount (conditional cards, batch mode).
  useEffect(() => {
    const scan = () => {
      const found = Array.from(
        document.querySelectorAll<HTMLElement>("[data-editor-section][id]"),
      ).map((element) => ({
        id: element.id,
        label: element.dataset.editorSection ?? element.id,
      }));
      setSections((previous) =>
        previous.length === found.length &&
        previous.every((section, index) => section.id === found[index]?.id)
          ? previous
          : found,
      );
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Highlight whichever section is nearest the top of the viewport.
  useEffect(() => {
    if (sections.length === 0) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.boundingClientRect.top);
          } else {
            visible.delete(entry.target.id);
          }
        });
        const topMost = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (topMost) setActiveId(topMost[0]);
      },
      // Ignore the band under the sticky topbar so the heading you just
      // scrolled to counts as "current", not the one above it.
      { rootMargin: "-64px 0px -60% 0px", threshold: 0 },
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Sections"
      className={cn(
        "sticky top-16 hidden max-h-[calc(100vh-6rem)] w-48 shrink-0 flex-col gap-0.5 overflow-y-auto xl:flex",
        className,
      )}
    >
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          onClick={(event) => {
            event.preventDefault();
            document
              .getElementById(section.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
            setActiveId(section.id);
          }}
          className={cn(
            "truncate rounded-md px-2 py-1.5 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            section.id === activeId
              ? "bg-accent font-semibold text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
