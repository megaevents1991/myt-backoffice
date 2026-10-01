"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichBodyEditor } from "@/components/templates/RichBodyEditor";
import { cn } from "@/lib/utils";
import { isSimpleHtml } from "@/components/tours/content/shared";

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * The document the preview frame shows. `<base>` makes `/media/...` images and
 * relative links resolve against the company's site, like they will there.
 */
function previewDocument(html: string, siteUrl: string | null | undefined): string {
  const base = siteUrl ? `<base href="${escapeAttr(siteUrl.replace(/\/+$/, "") + "/")}">` : "";
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">${base}<style>
body{margin:12px;font-family:Heebo,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;background:#fff;word-break:break-word}
img,video,iframe{max-width:100%;height:auto}
a{color:#60356C;pointer-events:none}
h1,h2,h3{line-height:1.25;margin:.6em 0 .3em}
p{margin:0 0 .7em}
ul,ol{padding-inline-start:1.4em;margin:0 0 .7em}
table{border-collapse:collapse;max-width:100%}
td,th{border:1px solid #e5e7eb;padding:4px 8px}
</style></head><body>${html}</body></html>`;
}

/** The value, a beat after the last keystroke - the preview frame reloads on every change. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Rendered preview of stored HTML. The HTML runs in a sandboxed frame with no
 * permissions at all: scripts, forms and navigation are off and the frame has
 * no access to the backoffice page or its cookies, so stored markup can never
 * act on the operator's session.
 */
export function HtmlPreview({
  html,
  siteUrl,
  className,
  title = "Preview",
}: {
  html: string;
  siteUrl?: string | null;
  className?: string;
  title?: string;
}) {
  const doc = useMemo(() => previewDocument(html, siteUrl), [html, siteUrl]);
  return (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={doc}
      className={cn("h-full min-h-[160px] w-full rounded-md border bg-white", className)}
    />
  );
}

type Mode = "code" | "visual";

interface HtmlFieldProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
  /** The company's site address - `/media/...` images in the preview load from it. */
  siteUrl?: string | null;
  rows?: number;
  hint?: string;
  className?: string;
}

/**
 * An HTML field of the site content: the source on one side, how it renders on
 * the other.
 *
 * The visual editor (the repo's RichBodyEditor) is offered only while the HTML
 * is simple - paragraphs, headings, lists, links, bold, italic. It rewrites
 * whatever it loads into that small vocabulary, so imported WordPress markup
 * (classes, images, Elementor containers) would be stripped by it; for such a
 * field the source + preview pair is the only safe editor.
 */
export function HtmlField({ label, value, onChange, siteUrl, rows = 10, hint, className }: HtmlFieldProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("code");
  const preview = useDebounced(value, 350);
  const simple = useMemo(() => isSimpleHtml(value), [value]);
  const visual = mode === "visual" && simple;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("code")}
            className={cn("rounded px-2 py-1", !visual && "bg-muted font-medium text-foreground")}
          >
            HTML & Preview
          </button>
          <button
            type="button"
            onClick={() => setMode("visual")}
            disabled={!simple}
            title={
              simple
                ? "Edit without code: headings, lists, links, bold and italic"
                : "This field has formatting the visual editor would remove (classes, images or imported structure), so it is edited as code"
            }
            className={cn(
              "rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50",
              visual && "bg-muted font-medium text-foreground",
            )}
          >
            Visual Editor
          </button>
        </div>
      </div>

      {visual ? (
        <div dir="rtl">
          <RichBodyEditor value={value} onChange={onChange} />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Textarea
            id={id}
            dir="ltr"
            rows={rows}
            spellCheck={false}
            className="font-mono text-xs leading-relaxed"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {preview.trim() ? (
            <HtmlPreview html={preview} siteUrl={siteUrl} title={`Preview: ${label}`} />
          ) : (
            <div className="flex min-h-[160px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              Nothing to preview
            </div>
          )}
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
