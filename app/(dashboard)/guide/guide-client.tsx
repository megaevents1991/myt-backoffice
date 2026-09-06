"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  type L,
} from "./guide-content";

type Lang = "en" | "he";
const LANG_KEY = "guide-lang";

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
                {step.label[lang]}
              </span>
              {step.sub && (
                <span className="text-xs leading-snug text-muted-foreground">
                  {step.sub[lang]}
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

export function GuideClient() {
  const [lang, setLang] = useState<Lang>("en");

  // Remember the reader's language across visits.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved === "he" || saved === "en") setLang(saved);
    } catch {
      /* private mode etc. - default stands */
    }
  }, []);

  const pick = (value: Lang) => {
    setLang(value);
    try {
      window.localStorage.setItem(LANG_KEY, value);
    } catch {
      /* ignore */
    }
  };

  const text = (value: L) => value[lang];
  const dir = lang === "he" ? "rtl" : "ltr";

  return (
    <div className="space-y-6">
      {/* Language toggle */}
      <div className="flex items-center justify-between gap-4">
        <p dir={dir} className="max-w-3xl text-sm text-muted-foreground">
          {text(GUIDE_UI.subtitle)}
        </p>
        <div className="flex shrink-0 rounded-lg bg-muted p-1" role="tablist" aria-label="Guide language">
          {(["en", "he"] as const).map((value) => (
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

      <div className="flex items-start gap-6">
        {/* On-this-page rail */}
        <nav
          dir={dir}
          className="sticky top-20 hidden w-52 shrink-0 xl:block"
          aria-label={text(GUIDE_UI.onThisPage)}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {text(GUIDE_UI.onThisPage)}
          </p>
          <ul className="space-y-1 text-sm">
            {GUIDE_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {text(section.title)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Sections */}
        <div dir={dir} className="min-w-0 flex-1 space-y-6">
          {GUIDE_SECTIONS.map((section) => (
            <Card
              key={section.id}
              id={section.id}
              className="scroll-mt-20"
            >
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 font-display">
                  {text(section.title)}
                  {section.adminOnly && (
                    <Badge variant="secondary" className="gap-1 text-xs font-normal">
                      <ShieldAlert className="h-3 w-3" />
                      {text(GUIDE_UI.adminBadge)}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {text(section.intro)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {section.flow && <FlowChart flow={section.flow} lang={lang} />}

                {section.points && (
                  <ul className="space-y-2 text-sm leading-relaxed">
                    {section.points.map((point, index) => (
                      <li key={index} className="flex gap-2">
                        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{text(point)}</span>
                      </li>
                    ))}
                  </ul>
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
                          <span>{text(rule)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {section.links && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {section.links.map((link) => (
                      <Button
                        key={link.href + link.label.en}
                        size="sm"
                        variant="outline"
                        asChild
                      >
                        <Link href={link.href}>
                          {text(GUIDE_UI.open)}: {text(link.label)}
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5 rtl:ml-0 rtl:mr-1.5 rtl:rotate-180" />
                        </Link>
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
