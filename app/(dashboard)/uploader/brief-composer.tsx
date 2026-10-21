"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Info, Mic, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AGENT_OFF_LINE } from "./copy";

// The brief box of /uploader (spec §5.1): one big textarea, two examples that fill it, and
// "פענח". With the agent off the same box stays (its text is still the run's brief), the examples
// go (nothing would parse them) and the button opens the manual plan form instead.

/** The two briefs the spec names - an artist tour and a team's home games. Clicking one FILLS the box. */
const EXAMPLES = [
  {
    label: "טור של אמן",
    icon: Mic,
    text:
      "יצא טור של אריק קלפטון באירופה. לכל היעדים שיש לנו לוקיישן קיים - לעלות כחבילה. לאלו שאין לוקיישן - לעלות ככרטיס בלבד. מארק אפ לכרטיס בלבד - 250 דולר. אדישנל מארק אפ - 75 דולר. כל הספקים שלנו.",
  },
  {
    label: "משחקי בית של קבוצה",
    icon: Trophy,
    text: "להעלות את כל משחקי הבית של ליברפול לעונה הקרובה. חבילה לכל יעד עם לוקיישן, אחרת לדלג. אדישנל מארק אפ 75 דולר.",
  },
] as const;

export function BriefComposer({
  value,
  onChange,
  max,
  agentOn,
  parsing,
  onParse,
  onManual,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The server refuses a longer brief (BRIEF_MAX). */
  max: number;
  agentOn: boolean;
  parsing: boolean;
  onParse: () => void;
  onManual: () => void;
  /** Coming back from the plan card ("ערוך את הבריף") puts the cursor back in the box. */
  autoFocus: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  /** Typed in (or filled from an example) this visit - a draft restored from the session is not flagged invalid until then. */
  const [touched, setTouched] = useState(false);
  const length = value.length;
  const tooLong = length > max;
  const empty = value.trim() === "";
  const canParse = agentOn && !parsing && !empty && !tooLong;
  // Manual needs no text (the brief is optional there), only a box that is not over the limit.
  const canManual = !agentOn && !tooLong;

  useEffect(() => {
    if (!autoFocus) return;
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  function fill(text: string) {
    setTouched(true);
    onChange(text);
    box.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (canParse) onParse();
    else if (canManual) onManual();
  }

  return (
    <section aria-labelledby="uploader-brief-title" className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="uploader-brief-title" className="font-display text-base font-semibold">
            בריף חדש
          </h2>
          {!agentOn && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Info aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {AGENT_OFF_LINE}
            </p>
          )}
        </div>

        <Label htmlFor="uploader-brief" className="sr-only">
          הבריף
        </Label>
        <Textarea
          ref={box}
          id="uploader-brief"
          dir="auto"
          rows={7}
          value={value}
          onChange={(e) => {
            setTouched(true);
            onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          disabled={parsing}
          aria-invalid={(touched && tooLong) || undefined}
          aria-describedby="uploader-brief-count"
          placeholder="כתבו מה להעלות, כמו שהייתם כותבים לעמית"
          className={cn(
            "min-h-[172px] resize-y text-[15px] leading-relaxed md:text-[15px]",
            tooLong && "border-destructive focus-visible:ring-destructive",
          )}
        />

        {agentOn && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">התחילו מדוגמה:</span>
            {EXAMPLES.map(({ label, icon: Icon, text }) => (
              <button
                key={label}
                type="button"
                disabled={parsing}
                onClick={() => fill(text)}
                aria-pressed={value === text}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-xs font-medium text-foreground transition-colors",
                  "hover:border-solid hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "disabled:pointer-events-none disabled:opacity-50",
                  value === text && "border-solid border-primary/40 bg-accent text-accent-foreground",
                )}
              >
                <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t bg-muted/40 px-5 py-3 sm:px-6">
        <div className="min-h-5 text-xs">
          {/* Announced: only the parse starting. The counter is read through the box's aria-describedby. */}
          <span role="status" aria-live="polite">
            {parsing && (
              <span className="flex items-center gap-2 text-muted-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />
                קורא את הבריף…
              </span>
            )}
          </span>
          {!parsing && (
            <span
              id="uploader-brief-count"
              className={cn("tabular-nums", tooLong ? "font-medium text-destructive" : "text-muted-foreground")}
            >
              <span dir="ltr">
                {length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
              </span>
              {tooLong && <> - הבריף ארוך מדי, קצרו אותו</>}
            </span>
          )}
        </div>

        {agentOn ? (
          <Button type="button" onClick={onParse} disabled={!canParse} title="Ctrl+Enter">
            פענח
          </Button>
        ) : (
          <Button type="button" onClick={onManual} disabled={!canManual} title="Ctrl+Enter">
            מלאו את התוכנית
          </Button>
        )}
      </div>
    </section>
  );
}
