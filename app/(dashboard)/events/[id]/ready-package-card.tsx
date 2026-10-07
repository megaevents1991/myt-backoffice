"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Eye, EyeOff, Globe, Loader2, PackagePlus, Pencil, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  adoptReadyPackage,
  buildReadyPackageSize,
  getReadyPackageCard,
  removeReadyPackage,
  setReadyPackageMode,
  setReadyPackageOptions,
  type ReadyActionResult,
  type ReadyCardData,
} from "@/lib/actions/ready-package-actions";
import {
  SWAP_ALL,
  SWAP_NONE,
  anySwap,
  formatSizeNotes,
  pairSizes,
  parseSizeNotes,
  targetSizes,
} from "@/lib/ready-package";
import { ReadyPackageBuilder } from "./ready-package-builder";
import {
  READY_PIECES,
  type ReadyPackageMode,
  type ReadyPiece,
  type ReadyRefreshStatus,
  type ReadySwap,
} from "@/types/ready-package.types";

/** The three states, as an answer to "is it on the site?". */
const MODES: {
  value: ReadyPackageMode;
  label: string;
  icon: typeof Globe;
  /** One sentence: what a customer and what staff get in this state. */
  says: string;
  active: string;
}[] = [
  {
    value: "off",
    label: "Off",
    icon: EyeOff,
    says: "Not on the site. The package is kept, but nothing opens it - not even the link.",
    active: "border-foreground/30 bg-muted text-foreground",
  },
  {
    value: "preview",
    label: "Preview",
    icon: Eye,
    says: "Not on the site yet. Customers get the regular flow; only the link below opens the package, for our own checks.",
    active: "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200",
  },
  {
    value: "live",
    label: "Live on the site",
    icon: Globe,
    says: "ON the site. A click on the event card opens this package for every customer.",
    active: "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  },
];

const STATUS_STYLE: Record<ReadyRefreshStatus, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  broken: "border-destructive/40 bg-destructive/10 text-destructive",
};

const STATUS_LABEL: Record<ReadyRefreshStatus, string> = {
  ok: "Every size priced",
  partial: "Some sizes are not offered",
  broken: "Cannot open",
};

const PIECE_LABEL: Record<ReadyPiece, string> = { ticket: "Ticket", flight: "Flight", hotel: "Hotel" };

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "never";

/**
 * The event's ready package ("חבילה מוכנה"): one house-built ticket + flight + hotel that a
 * click on the event card opens, as a visual one-page summary with a traveller picker. It is
 * built right here ("Build closed package") - or adopted from the partner portal - and this card
 * prices it for every party size the site sells (one call per size - each is a flight search
 * and a hotel search through the site), says which pieces the customer may swap, and above all
 * answers ONE question at the top: is it on the site (Live), only on our link (Preview), or Off.
 */
export function ReadyPackageCard({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const [data, setData] = useState<ReadyCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  // "Change a piece" / "Build closed package": the in-place builder. It loads nothing until opened.
  const [building, setBuilding] = useState(false);
  // The older way - a package built in the partner portal - is offered on request only.
  const [adopting, setAdopting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getReadyPackageCard(eventId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setData(res.data);
        else toast({ title: "Ready package", description: res.error, variant: "destructive" });
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      stopRef.current = true;
    };
    // toast (useToast) is a stable helper - intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const settle = useCallback(
    (res: ReadyActionResult): boolean => {
      if (!res.ok) {
        toast({ title: "Ready package", description: res.error, variant: "destructive" });
        return false;
      }
      setData(res.data);
      return true;
    },
    [toast],
  );

  /** One call per size: a whole package in one request would outlast the function window. */
  const priceSizes = async (sizes: number[], after?: string) => {
    stopRef.current = false;
    const missed: number[] = [];
    const problems: string[] = [];
    for (let i = 0; i < sizes.length && !stopRef.current; i++) {
      setBusy(`Pricing ${sizes[i]} traveller${sizes[i] === 1 ? "" : "s"} (${i + 1}/${sizes.length})`);
      const res = await buildReadyPackageSize(eventId, sizes[i]).catch(
        (): ReadyActionResult => ({ ok: false, error: `Could not price ${sizes[i]} travellers.` }),
      );
      if (!res.ok) problems.push(res.error);
      else {
        setData(res.data);
        if (res.message) {
          missed.push(sizes[i]);
          problems.push(res.message);
        }
      }
    }
    setBusy(null);
    // A size the pieces cannot serve is not an error - the site simply does not offer it.
    toast({
      title: problems.length === 0 ? "Ready package priced" : `Priced - ${missed.length || problems.length} size(s) are not offered`,
      description: [after, problems.length === 0 ? `${sizes.length} party size(s) are up to date.` : problems.join(" · ")]
        .filter(Boolean)
        .join(" "),
    });
  };

  const adopt = async () => {
    if (!picked) return;
    setBusy("Saving the package");
    const res = await adoptReadyPackage(eventId, picked).catch(
      (): ReadyActionResult => ({ ok: false, error: "Could not save the ready package." }),
    );
    setBusy(null);
    if (!settle(res) || !res.ok || !res.data.view) return;
    setAdopting(false);
    setPicked(null);
    // Every size sold, the built one included: the adopted composition may be days old, and a
    // fresh search is what gives it today's price (and the hotel's photo).
    await priceSizes(res.data.view.allowed);
  };

  const run = async (label: string, action: () => Promise<ReadyActionResult>): Promise<boolean> => {
    setBusy(label);
    const res = await action().catch((): ReadyActionResult => ({ ok: false, error: "The action failed." }));
    setBusy(null);
    return settle(res);
  };

  const saveSwap = (swap: ReadySwap) => run("Saving", () => setReadyPackageOptions(eventId, { swap }));

  const view = data?.view ?? null;
  // What the last pricing said per party size. A note that names no size (the event
  // is gone) is shown as it is.
  const sizeNotes = parseSizeNotes(view?.refreshNote);
  const noteLines = (formatSizeNotes(sizeNotes) ?? view?.refreshNote ?? "").split(" | ").filter(Boolean);

  /** Which party sizes are sold. A size that was just switched on is priced right away. */
  const saveSizes = async (next: number[]) => {
    if (!view) return;
    const added = next.filter((n) => !view.allowed.includes(n));
    const ok = await run("Saving", () => setReadyPackageOptions(eventId, { sizes: next }));
    if (ok && added.length > 0) await priceSizes(added);
  };
  const candidates = data?.candidates ?? [];
  const mode = MODES.find((m) => m.value === view?.mode) ?? MODES[0];

  return (
    <Card id="section-ready-package" data-editor-section="Ready package" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Ready package
          {view && (
            <Badge variant="outline" className={mode.active}>
              {view.mode === "live" ? "Live on the site" : view.mode === "preview" ? "Preview - not on the site" : "Off"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          One chosen ticket + flight + hotel. A click on the event card on the site lands the customer straight on
          a one-page summary of it, with a traveller picker - no steps to walk. Building and saving it changes
          nothing on the site: it goes live only when you switch it to Live below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </div>
        )}

        {!loading && view && (
          <>
            <div className={cn("space-y-2.5 rounded-md border p-3", mode.active)} data-ready-mode={view.mode}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold">Is it on the site?</span>
                <div className="flex overflow-hidden rounded-md border bg-background text-foreground" role="group" aria-label="Ready package mode">
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const on = view.mode === m.value;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        aria-pressed={on}
                        disabled={!!busy}
                        onClick={() => !on && run("Saving", () => setReadyPackageMode(eventId, m.value))}
                        className={cn(
                          "flex items-center gap-1.5 border-l px-3 py-1.5 text-sm font-medium transition-colors first:border-l-0 disabled:opacity-60",
                          on ? m.active : "hover:bg-muted/60",
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-sm">{mode.says}</p>
            </div>

            <div className="rounded-md border p-3 text-sm space-y-1.5">
              <div><span className="text-muted-foreground">Ticket: </span>{view.ticketLabel}</div>
              <div><span className="text-muted-foreground">Flight: </span>{view.flightLabel}</div>
              <div><span className="text-muted-foreground">Hotel: </span>{view.hotelLabel}</div>
              <div className="pt-1 font-medium">
                {view.pricePerPerson != null ? `$${view.pricePerPerson} per person` : "No price yet"}
                <span className="font-normal text-muted-foreground"> · built for {view.defaultTravelers}</span>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3" data-ready-sizes>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Sold to parties of:</span>
                {targetSizes(view.maxTravelers).map((n) => {
                  const sold = view.allowed.includes(n);
                  const priced = view.sizes.includes(n);
                  const built = n === view.defaultTravelers;
                  const said = sizeNotes.find((l) => l.size === n)?.text;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={sold}
                      disabled={!!busy || built}
                      onClick={() => saveSizes(sold ? view.allowed.filter((s) => s !== n) : [...view.allowed, n])}
                      title={
                        built
                          ? "The size it was built for - always sold"
                          : !sold
                            ? "Not sold - click to sell this party size"
                            : priced
                              ? `On the site${said ? ` (${said})` : ""} - click to stop selling this party size`
                              : `Not on the site: ${said ?? "its flight, hotel or ticket could not be priced for this size"}`
                      }
                      className={cn(
                        "h-8 min-w-8 rounded-md border px-2 text-sm font-medium tabular-nums transition-colors disabled:cursor-default",
                        !sold
                          ? "text-muted-foreground/60 line-through hover:bg-muted/50"
                          : priced
                            ? STATUS_STYLE.ok
                            : STATUS_STYLE.partial,
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
                <span className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => saveSizes(pairSizes())}>
                    Pairs only
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => saveSizes(targetSizes(view.maxTravelers))}>
                    All
                  </Button>
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Click a number to sell, or stop selling, that party size - the site&apos;s picker offers only these.
                Green = on the site. Amber = sold, but one of its pieces cannot serve that party (the reason is listed below), so it
                is not offered until it can. Crossed out = not sold. The size it was built for (
                {view.defaultTravelers}) always stays.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {view.refreshStatus && (
                  <Badge variant="outline" className={STATUS_STYLE[view.refreshStatus]}>
                    {STATUS_LABEL[view.refreshStatus]}
                  </Badge>
                )}
                <span className="text-muted-foreground">priced {when(view.refreshedAt)}</span>
              </div>
              {/* One line per reason: why a size is not on the site, or what changed on one that is. */}
              {noteLines.length > 0 && (
                <ul className="space-y-0.5 text-sm text-muted-foreground" data-ready-size-notes>
                  {noteLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-medium">The customer may swap:</span>
                {READY_PIECES.map((piece) => (
                  <label key={piece} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={view.swap[piece]}
                      disabled={!!busy}
                      onCheckedChange={(v) => saveSwap({ ...view.swap, [piece]: v === true })}
                    />
                    {PIECE_LABEL[piece]}
                  </label>
                ))}
                <span className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={!!busy || !anySwap(view.swap)} onClick={() => saveSwap(SWAP_NONE)}>
                    Nothing
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!!busy || (view.swap.ticket && view.swap.flight && view.swap.hotel)}
                    onClick={() => saveSwap(SWAP_ALL)}
                  >
                    Everything
                  </Button>
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {anySwap(view.swap)
                  ? "A ticked piece gets a small \"החלפה\" link on its card; the customer opens the regular step for it and comes back to the package. An unticked piece is fixed."
                  : "A closed package: the customer changes only the number of travellers."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => priceSizes(view.allowed)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {busy ?? "Refresh prices"}
              </Button>
              {busy?.startsWith("Pricing") && (
                <Button type="button" variant="ghost" size="sm" onClick={() => (stopRef.current = true)}>
                  Stop
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" disabled={view.mode === "off"} asChild={view.mode !== "off"}>
                {view.mode === "off" ? (
                  <span><ExternalLink className="h-4 w-4" /> Open on site</span>
                ) : (
                  <a href={view.previewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Open on site
                  </a>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={view.mode === "off"}
                onClick={() => {
                  navigator.clipboard.writeText(view.previewUrl).then(
                    () => toast({ title: "Link copied" }),
                    () => toast({ title: "Could not copy", description: view.previewUrl, variant: "destructive" }),
                  );
                }}
              >
                <Copy className="h-4 w-4" /> Copy link
              </Button>
              <Button
                type="button"
                variant={building ? "outline" : "ghost"}
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  setBuilding((v) => !v);
                  setAdopting(false);
                }}
              >
                <Pencil className="h-4 w-4" />
                {building ? "Keep this package" : "Change a piece"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={!!busy}
                onClick={async () => {
                  if (!confirmRemove) {
                    setConfirmRemove(true);
                    return;
                  }
                  setConfirmRemove(false);
                  await run("Removing", () => removeReadyPackage(eventId));
                }}
                onBlur={() => setConfirmRemove(false)}
              >
                {confirmRemove ? "Click again to remove" : "Remove"}
              </Button>
            </div>
          </>
        )}

        {!loading && (
          <div className="space-y-3">
            {!view && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant={building ? "outline" : "default"}
                  disabled={!!busy}
                  onClick={() => setBuilding((v) => !v)}
                >
                  <PackagePlus className="h-4 w-4" />
                  {building ? "Close the builder" : "Build closed package"}
                </Button>
                {!building && (
                  <span className="text-sm text-muted-foreground">
                    Choose the exact ticket, flight and hotel - ours or a supplier&apos;s - or let it compose them.
                  </span>
                )}
              </div>
            )}
            {building && (
              <ReadyPackageBuilder
                // "Change a piece" starts from what the package holds; a first build starts empty.
                key={view ? `change-${view.packageId}` : "new"}
                eventId={eventId}
                disabled={!!busy}
                initial={
                  view?.spec
                    ? { spec: view.spec, swap: view.swap, flightLabel: view.flightLabel, hotelLabel: view.hotelLabel }
                    : null
                }
                onBuilt={async (built) => {
                  setData(built);
                  setBuilding(false);
                  if (!built.view) return;
                  // The built size was looked up and priced a moment ago - only the other sold sizes are left.
                  const { allowed, defaultTravelers, mode: savedMode } = built.view;
                  await priceSizes(
                    allowed.filter((n) => n !== defaultTravelers),
                    savedMode === "live"
                      ? "Saved - the site already shows the new package."
                      : "Saved in Preview: customers do not see it yet. Switch it to Live to put it on the site.",
                  );
                }}
              />
            )}
            {candidates.length > 0 && !building && (
              <div className="space-y-2">
                <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={!!busy} onClick={() => setAdopting((v) => !v)}>
                  {adopting ? "Hide the portal packages" : `Or use a package built in the partner portal (${candidates.length})`}
                </Button>
                {adopting && (
                  <>
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {candidates.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!!c.problem || !!busy}
                          onClick={() => setPicked(c.id)}
                          className={cn(
                            "w-full rounded-md border p-2.5 text-left text-sm transition-colors",
                            picked === c.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                            c.problem && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <div className="font-medium">
                            {c.ticket} · {c.travelers} traveller{c.travelers === 1 ? "" : "s"}
                            <span className="font-normal text-muted-foreground">
                              {" "}· {c.partnerCode ?? "house"} · {when(c.createdAt)}
                            </span>
                          </div>
                          <div className="text-muted-foreground">{c.flight}</div>
                          <div className="text-muted-foreground">{c.hotel}</div>
                          {c.problem && <div className="mt-1 text-destructive">{c.problem}</div>}
                        </button>
                      ))}
                    </div>
                    <Button type="button" size="sm" disabled={!picked || !!busy} onClick={adopt}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {busy ?? "Use as the ready package"}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
