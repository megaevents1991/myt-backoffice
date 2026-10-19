"use client";

/**
 * Website > Mega Events Packages (19.10.2026): the Mega Events packages the company's site shows - in the
 * menu under its sport & music world, on that world's home page tile and on its page - and its search.
 * Staff pin the events they want first, choose which of Mega Events' rows fills the rest, hide what they
 * do not want, and set how many. Save stores it and updates the site's list at once; "Sync now" builds
 * the list again from Mega Events as it is (prices, sold-out events) - the cron does the same every 6 hours.
 */
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowDown, ArrowUp, EyeOff, ExternalLink, Eye, Loader2, Pin, PinOff, RefreshCw, Search, Sparkles, Ticket, X } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Chip, EmptyLine, Field, Ltr, Notice, Section } from "@/components/tours/ui";
import { ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { fmtInstant } from "@/lib/tours/format";
import {
  saveEventsControl,
  searchMegaEvents,
  syncEventsNow,
  type EventsScreenData,
  type EventsSyncReport,
  type MegaEventRef,
} from "@/lib/actions/tours-events-actions";
import { EVENTS_HIDDEN_MAX, EVENTS_PICKS_MAX, EVENTS_SHOWN_MAX, eventsControlSchema, type EventsControl } from "@/lib/tours/events-control";
import type { EventsFeedCategory, EventsFeedItem, EventsFeedRowKey } from "@/lib/tours/events-feed";

type Fill = "most_wanted" | "newest" | "both" | "none";

const FILLS: { value: Fill; label: string; hint: string }[] = [
  {
    value: "most_wanted",
    label: "Mega Events' most wanted (המבוקשים ביותר)",
    hint: "The row of Mega Events' home page, card for card - with the pins Mega Events set there.",
  },
  { value: "newest", label: "Mega Events' newest (החדשים)", hint: "The events uploaded to Mega Events last, the latest first." },
  { value: "both", label: "Most wanted, then newest", hint: "The most wanted first; the newest fill what is left." },
  { value: "none", label: "Only my pinned packages", hint: "Nothing automatic: the site shows the packages pinned below and no others." },
];

const fillOf = (auto: EventsFeedRowKey[]): Fill =>
  auto.length === 0 ? "none" : auto.length === 2 ? "both" : auto[0] === "newest" ? "newest" : "most_wanted";
const autoOf = (fill: Fill): EventsFeedRowKey[] =>
  fill === "none" ? [] : fill === "both" ? ["most_wanted", "newest"] : fill === "newest" ? ["newest"] : ["most_wanted"];

const CATEGORY: Record<EventsFeedCategory, string> = { sports: "Sport", music: "Music", other: "Other" };

/** An event of the site's list, as the screen lists events. */
const refOfItem = (item: EventsFeedItem): MegaEventRef => ({
  id: item.id,
  name: item.name,
  dateLabel: item.dateLabel,
  place: item.place,
  category: item.category,
  image: item.image,
  href: item.href,
  onSale: true,
});

/** One event on a line: its picture, name, date and place, category, and the actions at the end. */
function EventLine({ event, id, children, badge }: { event?: MegaEventRef; id: number; children?: ReactNode; badge?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="grid h-11 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {event?.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Mega Events picture on its own host
          <img src={event.image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Ticket className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span dir="rtl" className="truncate text-sm font-medium">
            {event?.name ?? `Event ${id}`}
          </span>
          {event && <Chip>{CATEGORY[event.category]}</Chip>}
          {badge}
          {event && !event.onSale && (
            <Chip tone="warning" title={event.note}>
              {event.note ?? "Not on sale"}
            </Chip>
          )}
          {!event && <Chip tone="error">Not found on Mega Events</Chip>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {event?.dateLabel && <Ltr>{event.dateLabel}</Ltr>}
          {event?.place && <span dir="rtl">{event.place}</span>}
          <Ltr className="text-muted-foreground/70">#{id}</Ltr>
          {event && (
            <a href={event.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
              Mega Events <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </li>
  );
}

/** What the last run did, in a line staff can act on. */
function SyncReport({ report }: { report: EventsSyncReport }) {
  const fromRows = report.siteError ? ` Mega Events' site could not be read (${report.siteError}), so the order was rebuilt from the event rows.` : "";
  if (report.error) return <Notice tone="error">Not updated: {report.error}.{fromRows}</Notice>;
  if (!report.changed) {
    return (
      <Notice tone="muted">
        No change: the site already shows this list ({report.items} packages, {report.indexed} events in its search).{fromRows}
      </Notice>
    );
  }
  const what = `${report.items} packages, ${report.indexed} events in the search`;
  if (!report.deploy) {
    return <Notice tone="info">The list was updated ({what}). The site shows it after its next rebuild - its connection is not set in Settings.{fromRows}</Notice>;
  }
  if (!report.deploy.ok) {
    return (
      <Notice tone="warning">
        The list was updated ({what}), but the site rebuild failed{report.deploy.error ? `: ${report.deploy.error}` : ""}. Click Revalidate Pages to try again.{fromRows}
      </Notice>
    );
  }
  return <Notice tone="success">The list was updated ({what}). The site is rebuilding - the change shows in about a minute.{fromRows}</Notice>;
}

export function EventsControlScreen({ initial }: { initial: EventsScreenData }) {
  const run = useActionToast();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<EventsControl>(initial.control);
  const [report, setReport] = useState<EventsSyncReport | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, startSync] = useTransition();
  // the version the next save must name; it moves with every successful save
  const version = useRef(initial.updatedAt);
  // every event the screen has met (the server's, the search's, the site list's), for names and pictures
  const [known, setKnown] = useState<Record<number, MegaEventRef>>(() => ({
    ...Object.fromEntries(initial.feed.items.map((item) => [item.id, refOfItem(item)])),
    ...initial.events,
  }));
  const learn = (events: MegaEventRef[]) => setKnown((current) => ({ ...current, ...Object.fromEntries(events.map((e) => [e.id, e])) }));

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.control), [form, saved.control]);
  const problem = useMemo(() => {
    const parsed = eventsControlSchema.safeParse(form);
    return parsed.success ? null : parsed.error.issues[0].message;
  }, [form]);

  const set = <K extends keyof EventsControl>(key: K, value: EventsControl[K]) => setForm((current) => ({ ...current, [key]: value }));
  const pin = (event: MegaEventRef) => {
    learn([event]);
    setForm((current) =>
      current.picks.includes(event.id)
        ? current
        : { ...current, picks: [...current.picks, event.id], hidden: current.hidden.filter((id) => id !== event.id) },
    );
  };
  const unpin = (id: number) => set("picks", form.picks.filter((p) => p !== id));
  const move = (index: number, by: -1 | 1) => {
    const next = [...form.picks];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    set("picks", next);
  };
  const hide = (event: MegaEventRef) => {
    learn([event]);
    setForm((current) =>
      current.hidden.includes(event.id)
        ? current
        : { ...current, hidden: [...current.hidden, event.id], picks: current.picks.filter((id) => id !== event.id) },
    );
  };
  const unhide = (id: number) => set("hidden", form.hidden.filter((h) => h !== id));

  const take = (data: { screen: EventsScreenData; sync: EventsSyncReport }) => {
    setSaved(data.screen);
    setForm(data.screen.control);
    version.current = data.screen.updatedAt;
    setReport(data.sync);
    setKnown((current) => ({
      ...current,
      ...Object.fromEntries(data.screen.feed.items.map((item) => [item.id, refOfItem(item)])),
      ...data.screen.events,
    }));
  };

  const save = async () => {
    if (isSaving || problem) return;
    setIsSaving(true);
    const result = await run(() => saveEventsControl(form, version.current), "Saved");
    setIsSaving(false);
    if (result.success) take(result.data);
  };

  const syncNow = () =>
    startSync(async () => {
      const result = await run(() => syncEventsNow());
      if (result.success) take(result.data);
    });

  // the search of Mega Events' events on sale, a moment after the typing stops
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MegaEventRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const result = await searchMegaEvents(q);
      if (!alive) return;
      setSearching(false);
      setResults(result.success ? result.data : []);
      if (result.success) setKnown((current) => ({ ...current, ...Object.fromEntries(result.data.map((e) => [e.id, e])) }));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const feed = saved.feed;
  const fill = fillOf(form.auto);
  const busy = isSaving || isSyncing;

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title="Mega Events Packages"
        description="The Mega Events packages your site shows: in the menu under the sport & music world, on its home page tile and on its page, each opening its order page on mega-events.co.il. Pin what you want first, choose what fills the rest, hide what you don't want. Save updates the site."
        actions={
          <>
            <ViewOnSiteButton href={saved.siteUrl} />
            <Button type="button" variant="outline" onClick={syncNow} disabled={busy || isDirty} title={isDirty ? "Save your changes first" : undefined}>
              <RefreshCw className={cn(isSyncing && "animate-spin")} />
              {isSyncing ? "Syncing…" : "Sync now"}
            </Button>
          </>
        }
      />

      {!saved.deployable && (
        <Notice tone="warning">The site connection (deploy hook) is not set in Settings: changes are stored, and the site shows them after its next rebuild.</Notice>
      )}
      {report && <SyncReport report={report} />}

      <Section
        icon={Ticket}
        tone="info"
        title="On the site now"
        description={
          feed.updatedAt
            ? `${feed.items.length} packages · ${feed.search ? `${feed.indexed} events in the search` : "the search lists this site's tours only"} · updated ${fmtInstant(feed.updatedAt)}${feed.updatedBy ? ` by ${feed.updatedBy}` : ""}`
            : "Nothing built yet - Sync now builds the first list."
        }
      >
        {feed.items.length === 0 ? (
          <EmptyLine>The site shows no Mega Events package.</EmptyLine>
        ) : (
          <ol className="divide-y">
            {feed.items.map((item, i) => {
              const event = known[item.id] ?? refOfItem(item);
              const pinned = saved.control.picks.includes(item.id);
              const hidden = form.hidden.includes(item.id);
              return (
                <EventLine
                  key={item.id}
                  id={item.id}
                  event={event}
                  badge={
                    <>
                      <Chip tone="outline">
                        <Ltr>{i + 1}</Ltr>
                      </Chip>
                      {pinned ? <Chip tone="info">Pinned</Chip> : <Chip>Automatic</Chip>}
                      <Chip tone="outline">
                        <Ltr>${item.price.toLocaleString("en-US")}</Ltr>
                      </Chip>
                      {hidden && <Chip tone="warning">Hidden after Save</Chip>}
                    </>
                  }
                >
                  {!form.picks.includes(item.id) && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => pin(event)} disabled={form.picks.length >= EVENTS_PICKS_MAX}>
                      <Pin />
                      Pin
                    </Button>
                  )}
                  {!hidden && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => hide(event)}>
                      <EyeOff />
                      Hide
                    </Button>
                  )}
                </EventLine>
              );
            })}
          </ol>
        )}
      </Section>

      <Section icon={Sparkles} tone="violet" title="What fills the list" description="After your pinned packages, in this order.">
        <RadioGroup value={fill} onValueChange={(value) => set("auto", autoOf(value as Fill))} className="gap-3">
          {FILLS.map((option) => (
            <div key={option.value} className="flex items-start gap-2.5">
              <RadioGroupItem value={option.value} id={`fill-${option.value}`} className="mt-0.5" />
              <Label htmlFor={`fill-${option.value}`} className="grid gap-0.5 font-normal">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
        <div className="flex flex-wrap items-end gap-6 border-t pt-4">
          <Field label="Packages on the site" hint={`1 to ${EVENTS_SHOWN_MAX}. The menu lists the first 6.`} htmlFor="events-max">
            <Input
              id="events-max"
              type="number"
              min={1}
              max={EVENTS_SHOWN_MAX}
              value={form.max}
              onChange={(e) => set("max", Math.trunc(Number(e.target.value)) || 0)}
              className="h-9 w-24"
            />
          </Field>
          <div className="flex items-start gap-2.5">
            <Switch id="events-search" checked={form.search} onCheckedChange={(checked) => set("search", checked)} className="mt-0.5" />
            <Label htmlFor="events-search" className="grid gap-0.5 font-normal">
              <span className="font-medium">The sport & music search lists Mega Events&apos; events</span>
              <span className="text-xs text-muted-foreground">Every event Mega Events sells, besides this site&apos;s own tours. Off: this site&apos;s tours only.</span>
            </Label>
          </div>
        </div>
      </Section>

      <Section
        icon={Pin}
        tone="brand"
        title="Pinned packages"
        description={`Shown first, in this order. An event Mega Events no longer sells is skipped by itself. Up to ${EVENTS_PICKS_MAX}.`}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Mega Events by name (Hebrew or English) or event number"
            aria-label="Search Mega Events' events"
            className="pl-9 pr-9"
          />
          {searching ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the search"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )
          )}
        </div>
        {results !== null && (
          <div className="rounded-md border">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{searching ? "Searching…" : "No event on sale matches."}</p>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto px-3">
                {results.map((event) => {
                  const isPinned = form.picks.includes(event.id);
                  return (
                    <EventLine key={event.id} id={event.id} event={event} badge={form.hidden.includes(event.id) ? <Chip tone="warning">Hidden</Chip> : undefined}>
                      <Button
                        type="button"
                        size="sm"
                        variant={isPinned ? "ghost" : "outline"}
                        onClick={() => pin(event)}
                        disabled={isPinned || form.picks.length >= EVENTS_PICKS_MAX}
                      >
                        <Pin />
                        {isPinned ? "Pinned" : "Pin"}
                      </Button>
                    </EventLine>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {form.picks.length === 0 ? (
          <EmptyLine>{fill === "none" ? "Nothing pinned: the site shows no Mega Events package." : "Nothing pinned: the list is all automatic."}</EmptyLine>
        ) : (
          <ol className="divide-y">
            {form.picks.map((id, i) => (
              <EventLine
                key={id}
                id={id}
                event={known[id]}
                badge={
                  <Chip tone="outline">
                    <Ltr>{i + 1}</Ltr>
                  </Chip>
                }
              >
                <Button type="button" size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <ArrowUp />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === form.picks.length - 1} aria-label="Move down">
                  <ArrowDown />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => unpin(id)}>
                  <PinOff />
                  Unpin
                </Button>
              </EventLine>
            ))}
          </ol>
        )}
      </Section>

      <Section icon={EyeOff} tone="neutral" title="Hidden packages" description={`Never shown on the site - not in the list, not in its search. Up to ${EVENTS_HIDDEN_MAX}.`}>
        {form.hidden.length === 0 ? (
          <EmptyLine>Nothing hidden. Hide an event from the list above.</EmptyLine>
        ) : (
          <ul className="divide-y">
            {form.hidden.map((id) => (
              <EventLine key={id} id={id} event={known[id]}>
                <Button type="button" size="sm" variant="ghost" onClick={() => unhide(id)}>
                  <Eye />
                  Show again
                </Button>
              </EventLine>
            ))}
          </ul>
        )}
      </Section>

      {saved.updatedBy && <p className="text-sm text-muted-foreground">Last saved by {saved.updatedBy}</p>}

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => void save()}
        onDiscard={() => setForm(saved.control)}
        saveLabel="Save and update the site"
        savingLabel="Updating the site…"
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message="Save stores your choice and updates the site's list right away."
      />
    </div>
  );
}
