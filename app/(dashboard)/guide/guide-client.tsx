"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ExternalLink, Search, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  GUIDE_SECTIONS,
  GUIDE_UI,
  type GuideFlow,
  type GuideSection,
  type L,
} from "./guide-content";
import { buildGuide, parseInline, searchText, type GuideGroup, type GuideItem } from "./guide-model";

type Lang = "en" | "he";
const LANG_KEY = "guide-lang";

/** Every link in the guide opens the screen in a new tab - the guide stays open. */
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Guide text with its [label](/path) links made live. */
function Rich({ value }: { value: string }) {
  return (
    <>
      {parseInline(value).map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            {...NEW_TAB}
            className="inline-flex items-baseline gap-0.5 font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {part.text}
            <ExternalLink aria-hidden className="h-3 w-3 shrink-0 self-center" />
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Little flow chart: boxes and arrows, wraps on small screens. */
function FlowChart({ flow, lang }: { flow: GuideFlow; lang: Lang }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {flow.title[lang]}
      </p>
      <div className="flex flex-wrap items-stretch gap-2">
        {flow.steps.map((step, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex min-h-[3rem] max-w-[240px] flex-col justify-center rounded-md border bg-card px-3 py-2">
              <span className="text-sm font-semibold leading-snug">
                <Rich value={step.label[lang]} />
              </span>
              {step.sub && (
                <span className="text-xs leading-snug text-muted-foreground">
                  <Rich value={step.sub[lang]} />
                </span>
              )}
            </div>
            {index < flow.steps.length - 1 && (
              <ArrowRight
                aria-hidden
                className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  lang,
  expanded,
}: {
  section: GuideSection;
  lang: Lang;
  /** Searching: every detail open, so a hit is never folded away. */
  expanded: boolean;
}) {
  const text = (value: L) => value[lang];
  const hasHowTo = !!section.howTo?.length;
  // The explanation folds away under the recipes; without recipes it IS the
  // content, so it starts open.
  const [open, setOpen] = useState(!hasHowTo);
  const detailsOpen = expanded || open;

  return (
    <Card id={section.id} className="scroll-mt-20">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 font-display text-lg">
          {text(section.title)}
          {section.adminOnly && (
            <Badge variant="secondary" className="gap-1 text-xs font-normal">
              <ShieldAlert className="h-3 w-3" />
              {text(GUIDE_UI.adminBadge)}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          <Rich value={text(section.intro)} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasHowTo && (
          <div className="grid gap-3 lg:grid-cols-2">
            {section.howTo?.map((recipe, index) => (
              <div key={index} className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 text-sm font-semibold">{text(recipe.title)}</p>
                <ol className="space-y-1.5 text-sm leading-relaxed">
                  {recipe.steps.map((step, n) => (
                    <li key={n} className="flex gap-2">
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary"
                      >
                        {n + 1}
                      </span>
                      <span className="min-w-0">
                        <Rich value={text(step)} />
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {section.flow && <FlowChart flow={section.flow} lang={lang} />}

        {section.points && section.points.length > 0 && (
          <div>
            {hasHowTo && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={detailsOpen}
                className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  aria-hidden
                  className={cn("h-3.5 w-3.5 transition-transform", !detailsOpen && "-rotate-90 rtl:rotate-90")}
                />
                {text(GUIDE_UI.howItWorks)} ({section.points.length})
              </button>
            )}
            {detailsOpen && (
              <ul className="space-y-2 text-sm leading-relaxed">
                {section.points.map((point, index) => (
                  <li key={index} className="flex gap-2">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0">
                      <Rich value={text(point)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {section.rules && (
          <div className="rounded-lg border border-warning/40 bg-warning-muted/50 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-warning">
              {text(GUIDE_UI.rules)}
            </p>
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {section.rules.map((rule, index) => (
                <li key={index} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                  <span className="min-w-0">
                    <Rich value={text(rule)} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {section.links && (
          <div className="flex flex-wrap gap-2 pt-1">
            {section.links.map((link) => (
              <Button key={link.href + link.label.en} size="sm" variant="outline" asChild>
                <a href={link.href} {...NEW_TAB}>
                  {text(link.label)}
                  <ExternalLink className="ms-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One sidebar screen: its header (open it in a new tab) and its sections. */
function ScreenBlock({ item, lang, expanded }: { item: GuideItem; lang: Lang; expanded: boolean }) {
  const text = (value: L) => value[lang];
  const Icon = item.icon;
  const isScreen = item.href.startsWith("/");
  return (
    <section id={item.anchor} className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2">
        {Icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <h3 className="font-display text-xl font-semibold">{text(item.label)}</h3>
        {item.adminOnly && (
          <Badge variant="secondary" className="gap-1 text-xs font-normal">
            <ShieldAlert className="h-3 w-3" />
            {text(GUIDE_UI.adminBadge)}
          </Badge>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          {item.subs.length > 0
            ? item.subs.map((sub) => (
                <Button key={sub.href} size="sm" variant="outline" asChild>
                  <a href={sub.href} {...NEW_TAB}>
                    {text(sub.label)}
                    <ExternalLink className="ms-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              ))
            : isScreen && (
                <Button size="sm" asChild>
                  <a href={item.href} {...NEW_TAB}>
                    {text(GUIDE_UI.openScreen)}
                    <ExternalLink className="ms-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
        </div>
      </div>
      {item.sections.map((section) => (
        <SectionCard key={section.id} section={section} lang={lang} expanded={expanded} />
      ))}
    </section>
  );
}

/** Contents: the sidebar's groups and screens, jumping inside this page. */
function Contents({ groups, lang, compact }: { groups: GuideGroup[]; lang: Lang; compact?: boolean }) {
  return (
    <div className={cn(compact ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-4")}>
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label[lang]}
          </p>
          <ul className="space-y-0.5 text-sm">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.anchor}>
                  <a
                    href={`#${item.anchor}`}
                    className="flex items-center gap-2 rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{item.label[lang]}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function GuideClient() {
  const [lang, setLang] = useState<Lang>("he");
  const [query, setQuery] = useState("");
  const [langReady, setLangReady] = useState(false);

  // Remember the reader's language across visits.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved === "he" || saved === "en") setLang(saved);
    } catch {
      /* private mode etc. - default stands */
    }
    setLangReady(true);
  }, []);

  // Arriving from a screen's "Guide" button (/guide#nav-events): land on that
  // screen once the stored language is on screen - switching to English after
  // the browser's own jump moves every section below the top.
  useEffect(() => {
    if (!langReady) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [langReady]);

  const pick = (value: Lang) => {
    setLang(value);
    try {
      window.localStorage.setItem(LANG_KEY, value);
    } catch {
      /* ignore */
    }
  };

  const all = useMemo(() => buildGuide(GUIDE_SECTIONS), []);
  const searching = query.trim().length > 0;
  const groups = useMemo(() => {
    if (!searching) return all;
    return all
      .map((group) => ({
        ...group,
        items: group.items
          .map((item) => ({
            ...item,
            sections: item.sections.filter((s) =>
              matchesSearch(query, item.label.en, item.label.he, searchText(s)),
            ),
          }))
          .filter((item) => item.sections.length > 0),
      }))
      .filter((group) => group.items.length > 0);
  }, [all, query, searching]);

  const text = (value: L) => value[lang];
  const dir = lang === "he" ? "rtl" : "ltr";

  return (
    <div className="space-y-6">
      {/* Language */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p dir={dir} className="max-w-3xl text-sm text-muted-foreground">
          {text(GUIDE_UI.subtitle)}
        </p>
        <div className="flex shrink-0 rounded-lg bg-muted p-1" role="tablist" aria-label="Guide language">
          {(["he", "en"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={lang === value}
              onClick={() => pick(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                lang === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "en" ? "English" : "עברית"}
            </button>
          ))}
        </div>
      </div>

      {/* Search - both languages, so an English button name finds the Hebrew step too */}
      <div dir={dir} className="relative max-w-xl">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={text(GUIDE_UI.searchPlaceholder)}
          aria-label={text(GUIDE_UI.searchPlaceholder)}
          className="ps-9"
        />
      </div>

      {/* Contents on narrower screens (the rail takes over from xl) */}
      {!searching && (
        <Card dir={dir} className="xl:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{text(GUIDE_UI.onThisPage)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Contents groups={all} lang={lang} compact />
          </CardContent>
        </Card>
      )}

      <div className="flex items-start gap-6">
        <nav
          dir={dir}
          className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-56 shrink-0 overflow-y-auto xl:block"
          aria-label={text(GUIDE_UI.onThisPage)}
        >
          <Contents groups={groups} lang={lang} />
        </nav>

        <div dir={dir} className="min-w-0 flex-1 space-y-10">
          {groups.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {text(GUIDE_UI.noResults)}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.key} className="space-y-6">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-primary">
                {text(group.label)}
              </h2>
              {group.items.map((item) => (
                <ScreenBlock key={item.anchor} item={item} lang={lang} expanded={searching} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
