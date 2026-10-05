"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, PackagePlus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { READY_MAX_TRAVELERS_CAP, targetSizes } from "@/lib/ready-package";
import { ReadyPackageBuilder } from "./ready-package-builder";
import type { ReadyPackageMode, ReadyRefreshStatus } from "@/types/ready-package.types";

const MODE_HELP: Record<ReadyPackageMode, string> = {
  off: "Regular flow. The package is kept, nothing opens on it.",
  preview: "Hidden from customers - a click on the site card still opens the regular flow. Only the link below opens the package.",
  live: "A click on the event card on the site opens this package.",
};

const STATUS_STYLE: Record<ReadyRefreshStatus, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  broken: "border-destructive/40 bg-destructive/10 text-destructive",
};

const STATUS_LABEL: Record<ReadyRefreshStatus, string> = {
  ok: "All sizes priced",
  partial: "Some sizes missing",
  broken: "Cannot open",
};

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "never";

/**
 * The event's ready package ("חבילה מוכנה"): one house-built ticket + flight + hotel that a
 * click on the event card opens, as a visual summary with a traveller picker. The package is
 * built in the portal wizard and ADOPTED here; this card prices it for every party size
 * (one call per size - each is a flight search and a hotel search through the site) and
 * decides who sees it: nobody (off), staff only (preview), or every customer (live).
 */
export function ReadyPackageCard({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const [data, setData] = useState<ReadyCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  // The in-place builder is opened on request: it loads the event's tickets only then.
  const [building, setBuilding] = useState(false);
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
  const priceSizes = async (sizes: number[]) => {
    stopRef.current = false;
    const problems: string[] = [];
    for (let i = 0; i < sizes.length && !stopRef.current; i++) {
      setBusy(`Pricing ${sizes[i]} traveller${sizes[i] === 1 ? "" : "s"} (${i + 1}/${sizes.length})`);
      const res = await buildReadyPackageSize(eventId, sizes[i]).catch(
        (): ReadyActionResult => ({ ok: false, error: `Could not price ${sizes[i]} travellers.` }),
      );
      if (!res.ok) problems.push(res.error);
      else {
        setData(res.data);
        if (res.message) problems.push(res.message);
      }
    }
    setBusy(null);
    toast({
      title: problems.length === 0 ? "Ready package priced" : "Ready package priced, with gaps",
      description: problems.length === 0 ? `${sizes.length} party size(s) are up to date.` : problems.join(" · "),
      variant: problems.length === 0 ? undefined : "destructive",
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
    setChoosing(false);
    setPicked(null);
    // Every size, the built one included: the adopted composition may be days old, and a fresh
    // search is what gives it today's price (and the hotel's photo).
    await priceSizes(targetSizes(res.data.view.maxTravelers));
  };

  const run = async (label: string, action: () => Promise<ReadyActionResult>): Promise<boolean> => {
    setBusy(label);
    const res = await action().catch((): ReadyActionResult => ({ ok: false, error: "The action failed." }));
    setBusy(null);
    return settle(res);
  };

  const view = data?.view ?? null;
  const candidates = data?.candidates ?? [];
  const showPicker = !view || choosing;

  return (
    <Card id="section-ready-package" data-editor-section="Ready package" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Ready package
          {view && (
            <Badge variant="outline" className={cn(view.mode === "live" && STATUS_STYLE.ok)}>
              {view.mode === "live" ? "Live" : view.mode === "preview" ? "Preview" : "Off"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          One chosen ticket + flight + hotel. A click on the event card on the site lands the customer straight on
          a visual summary of it, with a traveller picker - no steps to walk. Nothing changes for the site until
          the mode is Live.
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
            <div className="rounded-md border p-3 text-sm space-y-1.5">
              <div><span className="text-muted-foreground">Ticket: </span>{view.ticketLabel}</div>
              <div><span className="text-muted-foreground">Flight: </span>{view.flightLabel}</div>
              <div><span className="text-muted-foreground">Hotel: </span>{view.hotelLabel}</div>
              <div className="pt-1 font-medium">
                {view.pricePerPerson != null ? `$${view.pricePerPerson} per person` : "No price yet"}
                <span className="font-normal text-muted-foreground"> · built for {view.defaultTravelers}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Party sizes:</span>
              {targetSizes(view.maxTravelers).map((n) => (
                <Badge
                  key={n}
                  variant="outline"
                  className={cn(view.sizes.includes(n) ? STATUS_STYLE.ok : "text-muted-foreground line-through")}
                  title={view.sizes.includes(n) ? "Priced - the picker offers it" : "Not priced - the picker does not offer it"}
                >
                  {n}
                </Badge>
              ))}
              {view.refreshStatus && (
                <Badge variant="outline" className={STATUS_STYLE[view.refreshStatus]}>
                  {STATUS_LABEL[view.refreshStatus]}
                </Badge>
              )}
              <span className="text-muted-foreground">· priced {when(view.refreshedAt)}</span>
            </div>
            {view.refreshNote && <p className="text-sm text-muted-foreground">{view.refreshNote}</p>}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select
                  value={view.mode}
                  disabled={!!busy}
                  onValueChange={(mode) =>
                    run("Saving", () => setReadyPackageMode(eventId, mode as ReadyPackageMode))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="preview">Preview (staff only)</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Max travellers</Label>
                <Select
                  value={String(view.maxTravelers)}
                  disabled={!!busy}
                  onValueChange={async (value) => {
                    const max = Number(value);
                    const ok = await run("Saving", () => setReadyPackageOptions(eventId, { maxTravelers: max }));
                    if (!ok) return;
                    const missing = targetSizes(max).filter((n) => !view.sizes.includes(n));
                    if (missing.length > 0) await priceSizes(missing);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: READY_MAX_TRAVELERS_CAP }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)} disabled={n < view.defaultTravelers}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <Label htmlFor="ready-allow-edit" className="cursor-pointer">
                  Customer may swap pieces
                </Label>
                <Switch
                  id="ready-allow-edit"
                  checked={view.allowEdit}
                  disabled={!!busy}
                  onCheckedChange={(allowEdit) => run("Saving", () => setReadyPackageOptions(eventId, { allowEdit }))}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{MODE_HELP[view.mode]}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => priceSizes(targetSizes(view.maxTravelers))}>
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
              <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => setChoosing((v) => !v)}>
                {choosing ? "Keep this package" : "Replace"}
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

        {!loading && showPicker && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant={building ? "outline" : "default"}
                disabled={!!busy}
                onClick={() => setBuilding((v) => !v)}
              >
                <PackagePlus className="h-4 w-4" />
                {building ? "Close the builder" : view ? "Build a new closed package" : "Build closed package"}
              </Button>
              {!building && (
                <span className="text-sm text-muted-foreground">
                  Choose the ticket, the flight and the hotel right here - or let it compose them.
                </span>
              )}
            </div>
            {building && (
              <ReadyPackageBuilder
                eventId={eventId}
                disabled={!!busy}
                onBuilt={async (built) => {
                  setData(built);
                  setBuilding(false);
                  setChoosing(false);
                  if (!built.view) return;
                  // The built size was looked up and priced a moment ago - only the others are left.
                  const { maxTravelers, defaultTravelers } = built.view;
                  await priceSizes(targetSizes(maxTravelers).filter((n) => n !== defaultTravelers));
                }}
              />
            )}
            {candidates.length > 0 && (
              <>
                <p className="pt-1 text-sm font-medium">Or use a package built in the partner portal</p>
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
      </CardContent>
    </Card>
  );
}
