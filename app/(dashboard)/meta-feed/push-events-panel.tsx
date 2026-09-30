"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Paintbrush, TriangleAlert, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchInput } from "@/components/search-input";
import { useToast } from "@/hooks/use-toast";
import { matchesSearch } from "@/lib/search";
import {
  renderEventCreativeAction,
  syncMetaFeedAction,
  type FeedPickerEvent,
} from "@/lib/actions/meta-feed-actions";

/** Rows shown in the list at once - search narrows the rest. */
const LIST_MAX = 40;
/** A render is a couple of seconds each; this keeps one click bounded. */
const PICK_MAX = 20;

const CREATIVE_TEXT = {
  generated: "צויר מחדש",
  current: "ללא שינוי",
  skipped: "לא צויר",
} as const;

type Line =
  | { status: "running" }
  | { status: "rendered"; note: string; blockers: string[]; inFeed?: boolean }
  | { status: "failed"; error: string };

type PublishState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; note: string }
  | { status: "failed"; error: string };

function eventDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * "These events into the Meta feed now": pick one or several, each is
 * redrawn from scratch (even when nothing on it changed - that is the point:
 * staff fixed something the creative hash cannot see) under a new image URL
 * so Meta refetches the picture, then the feed file is published once.
 * One request per event + one publish, like "סנכרן הכל" runs a step per
 * request, so no single call meets a function duration limit.
 */
export function PushEventsPanel({ events }: { events: FeedPickerEvent[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [publish, setPublish] = useState<PublishState>({ status: "idle" });

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return events;
    return events.filter((e) => matchesSearch(q, e.name, e.name_english, e.id));
  }, [events, query]);
  const shown = matches.slice(0, LIST_MAX);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const toggle = (id: number, on: boolean) => {
    setPicked((prev) => {
      if (!on) return prev.filter((x) => x !== id);
      if (prev.includes(id)) return prev;
      if (prev.length >= PICK_MAX) {
        toast({
          variant: "destructive",
          title: `עד ${PICK_MAX} אירועים בלחיצה`,
          description: "הריצו את אלה קודם, ואז בחרו את הבאים.",
        });
        return prev;
      }
      return [...prev, id];
    });
  };

  const onRun = async () => {
    if (picked.length === 0 || running) return;
    setRunning(true);
    setLines({});
    setPublish({ status: "idle" });
    const rendered: number[] = [];
    let failures = 0;

    for (const id of picked) {
      setLines((prev) => ({ ...prev, [id]: { status: "running" } }));
      const res = await renderEventCreativeAction(id, { force: true });
      if (!res.ok) {
        failures++;
        setLines((prev) => ({ ...prev, [id]: { status: "failed", error: res.error } }));
        continue;
      }
      rendered.push(id);
      const note = res.creativeNote
        ? `${CREATIVE_TEXT[res.creative]} (${res.creativeNote})`
        : CREATIVE_TEXT[res.creative];
      setLines((prev) => ({
        ...prev,
        [id]: { status: "rendered", note, blockers: res.blockers },
      }));
    }

    setPublish({ status: "running" });
    const pub = await syncMetaFeedAction();
    if (!pub.ok) {
      setPublish({ status: "failed", error: pub.error });
      setRunning(false);
      toast({
        variant: "destructive",
        title: "הקריאייטיבים צוירו, אבל פרסום הפיד נכשל",
        description: `${pub.error} - לחצו "סנכרן פיד עכשיו" למעלה.`,
      });
      return;
    }
    const inFeed = new Set(pub.result.activityIds);
    setLines((prev) => {
      const next = { ...prev };
      for (const id of rendered) {
        const line = next[id];
        if (line?.status === "rendered") next[id] = { ...line, inFeed: inFeed.has(id) };
      }
      return next;
    });
    setPublish({ status: "done", note: `${pub.result.activityRows} אירועים בקובץ שמטא קוראת` });
    setRunning(false);
    router.refresh();

    const inCount = rendered.filter((id) => inFeed.has(id)).length;
    const outCount = rendered.length - inCount;
    toast({
      title: outCount === 0 && failures === 0 ? "בפיד - מטא קוראת את הקובץ כל שעה" : "הסתיים עם הערות",
      description: [
        `${inCount} בפיד`,
        outCount ? `${outCount} לא נכנסו (הסיבה ליד כל אירוע)` : null,
        failures ? `${failures} נכשלו` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      variant: failures ? "destructive" : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="חיפוש לפי שם, שם באנגלית או מזהה…"
          wrapperClassName="w-full sm:w-[360px]"
        />
        <span className="text-sm text-muted-foreground">
          {matches.length === events.length
            ? `${events.length} אירועים עתידיים`
            : `${matches.length} מתוך ${events.length}`}
        </span>
      </div>

      <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">אין אירוע כזה.</li>
        )}
        {shown.map((event) => {
          const checked = pickedSet.has(event.id);
          return (
            <li key={event.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => toggle(event.id, v === true)}
                  disabled={running}
                  aria-label={event.name}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{event.name || event.name_english}</span>
                  {event.name && event.name_english && (
                    <span className="text-muted-foreground"> · {event.name_english}</span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                  {eventDate(event.date)}
                </span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  #{event.id}
                </span>
                {!event.hasCreative && (
                  <Badge
                    variant="outline"
                    className="text-amber-700 dark:text-amber-400"
                    title={event.skipReason ?? undefined}
                  >
                    אין קריאייטיב
                  </Badge>
                )}
                {event.isTest && <Badge variant="secondary">בדיקה</Badge>}
              </label>
            </li>
          );
        })}
        {matches.length > LIST_MAX && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            עוד {matches.length - LIST_MAX} - חפשו כדי לצמצם.
          </li>
        )}
      </ul>

      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {picked.map((id) => {
            const event = byId.get(id);
            return (
              <Badge key={id} variant="secondary" className="gap-1 pe-1">
                <span className="max-w-[16rem] truncate">
                  {event?.name || event?.name_english || `#${id}`}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(id, false)}
                  disabled={running}
                  className="rounded-full p-0.5 hover:bg-background/60"
                  aria-label="הסר"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPicked([])}
            disabled={running}
          >
            נקה בחירה
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onRun} disabled={running || picked.length === 0}>
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Paintbrush className="mr-2 h-4 w-4" />
          )}
          {running
            ? "מצייר ומעלה…"
            : picked.length > 1
              ? `צייר מחדש והעלה לפיד (${picked.length})`
              : "צייר מחדש והעלה לפיד"}
        </Button>
        <span className="text-xs text-muted-foreground">
          מצייר את הקריאייטיב מחדש גם אם לא השתנה בו כלום, ואז מפרסם את הקובץ פעם אחת.
        </span>
      </div>

      {Object.keys(lines).length > 0 && (
        <ul className="space-y-1 text-sm">
          {picked.map((id) => {
            const line = lines[id];
            if (!line) return null;
            const name = byId.get(id)?.name || byId.get(id)?.name_english || `#${id}`;
            return (
              <li key={id} className="flex items-start gap-2">
                {line.status === "running" && (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                {line.status === "failed" && (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                )}
                {line.status === "rendered" && line.inFeed === false && (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                )}
                {line.status === "rendered" && line.inFeed !== false && (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                )}
                <span>
                  <span className="font-medium">{name}</span>{" "}
                  <span className="text-muted-foreground">
                    {line.status === "running" && "מצייר…"}
                    {line.status === "failed" && line.error}
                    {line.status === "rendered" && line.note}
                    {line.status === "rendered" && line.inFeed === false && (
                      <>
                        {" · לא בפיד: "}
                        {line.blockers.length > 0
                          ? line.blockers.join(" · ")
                          : "לא נמצאה סיבה בנתוני האירוע - בדקו ב-/product-feed באתר"}
                      </>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
          {publish.status !== "idle" && (
            <li className="flex items-start gap-2 border-t pt-1">
              {publish.status === "running" && (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {publish.status === "done" && (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              )}
              {publish.status === "failed" && (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <span>
                <span className="font-medium">פרסום הפיד</span>{" "}
                <span className="text-muted-foreground">
                  {publish.status === "running" && "מפרסם…"}
                  {publish.status === "done" && publish.note}
                  {publish.status === "failed" && publish.error}
                </span>
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
