"use client";

/**
 * Dialogs opened from the departures board: a new departure, paste prices from
 * Excel, copy prices from another departure, add a promotion to the selection,
 * and the summary of a bulk action that skipped rows.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CheckField, Chip, Field, Ltr, Notice, selectClass } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { EMPTY, addDays, fmtDateRange, fmtPrice, isDateOnly, nightsBetween } from "@/lib/tours/format";
import { departureRouteLabel } from "@/lib/tours/routes";
import { PRICE_MATRIX_ROWS } from "@/types/tours.types";
import {
  addPromotionToDepartures,
  applyPastedPrices,
  copyDeparturePrices,
  createDeparture,
} from "@/lib/actions/tours-departure-actions";
import {
  departureCode,
  parsePastedPrices,
  periodLabel,
  periodsOverlapping,
  seasonYearOf,
} from "./departure-utils";
import {
  PromotionFields,
  draftToInput,
  emptyPromotionDraft,
  promotionDraftError,
  type PromotionDraft,
} from "./promotion-fields";
import type { BoardPackage, BoardPeriod, BoardRow, BoardSeries, BulkOutcome } from "./types";

const SHORT_MATRIX_LABELS = ["Single", "Double", "Adult 3", "Child 2", "Child 3", "Child 4"];

// ---------------------------------------------------------------- outcome of a bulk action
export function BulkOutcomeDialog({
  title,
  outcome,
  onClose,
}: {
  title: string;
  outcome: BulkOutcome | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(outcome)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pe-8 text-start sm:text-start">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {outcome ? `Updated ${outcome.done.length} departures. ${outcome.skipped.length ? `${outcome.skipped.length} not updated.` : ""}` : ""}
          </DialogDescription>
        </DialogHeader>
        {outcome && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {outcome.skipped.length > 0 && (
              <Notice tone="error">
                <p className="mb-1 font-semibold">Not updated</p>
                <ul className="space-y-1">
                  {outcome.skipped.map((s) => (
                    <li key={s.code}>
                      <Ltr className="font-mono font-semibold">{s.code}</Ltr> - {s.reason}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {outcome.warnings.length > 0 && (
              <Notice tone="warning">
                <p className="mb-1 font-semibold">Updated, with a warning</p>
                <ul className="space-y-1">
                  {outcome.warnings.map((s) => (
                    <li key={s.code}>
                      <Ltr className="font-mono font-semibold">{s.code}</Ltr> - {s.reason}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- new departure
export function NewDepartureDialog({
  open,
  onOpenChange,
  series,
  packages,
  periods,
  typicalNights,
  defaultSeriesId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: BoardSeries[];
  packages: BoardPackage[];
  periods: BoardPeriod[];
  /** Usual trip length of each series, learned from its existing departures. */
  typicalNights: Map<string, number>;
  defaultSeriesId?: string;
  onCreated: (created: { id: string; code: string }) => void;
}) {
  const [seriesId, setSeriesId] = useState(defaultSeriesId ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [season, setSeason] = useState("");
  const [saving, setSaving] = useState(false);
  const run = useActionToast();
  const packageName = useMemo(() => new Map(packages.map((p) => [p.id, p.name])), [packages]);
  const chosen = series.find((s) => s.id === seriesId);
  const nightsOf = (s: BoardSeries | undefined) => (s ? (s.default_nights ?? typicalNights.get(s.id) ?? null) : null);

  const onStart = (value: string) => {
    setStart(value);
    const nights = nightsOf(chosen);
    if (isDateOnly(value) && nights != null && (!end || end < value)) setEnd(addDays(value, nights));
  };
  const onSeries = (id: string) => {
    setSeriesId(id);
    const nights = nightsOf(series.find((s) => s.id === id));
    if (isDateOnly(start) && nights != null) setEnd(addDays(start, nights));
  };

  const valid = Boolean(chosen && isDateOnly(start) && isDateOnly(end) && end >= start);
  const code = chosen && isDateOnly(start) ? departureCode(chosen.code, start) : "";
  const holidays = valid ? periodsOverlapping(periods, start, end) : [];

  const submit = async () => {
    if (!chosen || !valid) return;
    setSaving(true);
    const result = await run(
      () => createDeparture({ seriesId: chosen.id, start_date: start, end_date: end, season: season || null }),
      (answer) => `Departure ${answer.data.code} created as a draft`,
    );
    setSaving(false);
    if (!result.success) return;
    setStart("");
    setEnd("");
    setSeason("");
    onOpenChange(false);
    onCreated(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="pe-8 text-start sm:text-start">
          <DialogTitle>New Departure</DialogTitle>
          <DialogDescription>
            The departure is created as an unpublished draft. Its code is built from the series code and the departure date; route, currency and capacity come from the series.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Series" className="col-span-2">
            <select className={`${selectClass} w-full`} value={seriesId} onChange={(e) => onSeries(e.target.value)}>
              <option value="">Choose a series…</option>
              {series
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.package_id}>
                    {s.code}
                    {s.label ? ` · ${s.label}` : ""} · {s.package_id ? (packageName.get(s.package_id) ?? "") : "No tour page"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Departure date">
            <Input dir="ltr" type="date" className="h-9" value={start} onChange={(e) => onStart(e.target.value)} />
          </Field>
          <Field label="Return date">
            <Input dir="ltr" type="date" className="h-9" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Season (optional)" className="col-span-2">
            <Input dir="auto" className="h-9" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. קיץ, פסח, חגי תשרי" list="tours-season-suggestions" />
          </Field>
        </div>
        {chosen && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Code: <Ltr className="font-mono font-semibold">{code || EMPTY}</Ltr>
                {isDateOnly(start) && <span className="text-muted-foreground"> ({seasonYearOf(start)})</span>}
              </span>
              <span>
                Route:{" "}
                <Ltr className="font-mono">{departureRouteLabel(chosen.arrival_airport, chosen.return_airport) || "Not set on the series"}</Ltr>
              </span>
              {valid && <span>Nights: {nightsBetween(start, end)}</span>}
              <span>
                Currency: <Ltr>{chosen.default_currency}</Ltr>
              </span>
            </div>
            {holidays.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {holidays.map((h) => (
                  <Chip key={h.id} tone="warning">
                    {periodLabel(h)}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Create Departure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- paste from Excel
export function PastePricesDialog({
  open,
  onOpenChange,
  rows,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The departures loaded on the board - a pasted code is matched against them. */
  rows: BoardRow[];
  onApplied: (outcome: BulkOutcome) => void;
}) {
  const [textValue, setTextValue] = useState("");
  const [saving, setSaving] = useState(false);
  const run = useActionToast();

  const byCode = useMemo(() => {
    const map = new Map<string, BoardRow[]>();
    for (const r of rows) {
      if (r.is_deleted) continue;
      map.set(r.code, [...(map.get(r.code) ?? []), r]);
    }
    return map;
  }, [rows]);

  const preview = useMemo(() => {
    const seen = new Set<string>();
    return parsePastedPrices(textValue).map((p) => {
      const matches = byCode.get(p.code) ?? [];
      let error = p.error;
      if (!error && matches.length === 0) error = "Code not found among the departures on the board";
      if (!error && matches.length > 1) error = "Code exists in more than one year - filter the board to a single year";
      if (!error && seen.has(p.code)) error = "Code appears twice in the paste";
      seen.add(p.code);
      const target = !error ? matches[0] : null;
      if (target && target.options.length > 0 && Object.keys(target.prices).length === 0) {
        error = "Vacation package - priced from hotel and ticket, not from a matrix";
      }
      return { ...p, error, target: error ? null : target };
    });
  }, [textValue, byCode]);

  const valid = preview.filter((p) => p.target);
  const invalid = preview.length - valid.length;

  const apply = async () => {
    setSaving(true);
    const result = await run(() => applyPastedPrices(valid.map((p) => ({ departureId: p.target!.id, prices: p.prices }))));
    setSaving(false);
    if (!result.success) return;
    setTextValue("");
    onOpenChange(false);
    onApplied(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader className="pe-8 text-start sm:text-start">
          <DialogTitle>Paste Prices</DialogTitle>
          <DialogDescription>
            Copy rows from the spreadsheet: a departure code followed by six price columns, in this order: {PRICE_MATRIX_ROWS.map((r) => r.label).join(" · ")}. An
            empty cell removes that price.
          </DialogDescription>
        </DialogHeader>
        <textarea
          dir="ltr"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={"CBEA1014\t2645\t2145\t2145\t2125\t\t"}
          spellCheck={false}
          className="h-28 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {preview.length > 0 && (
          <div className="max-h-[40vh] overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1.5 text-start font-semibold">Code</th>
                  {SHORT_MATRIX_LABELS.map((l) => (
                    <th key={l} className="px-2 py-1.5 text-end font-semibold">
                      {l}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-start font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={`${p.line}-${p.code}`} className={cn("border-t", p.error && "bg-destructive/5")}>
                    <td className="px-2 py-1 font-mono font-semibold">
                      <Ltr>{p.code || EMPTY}</Ltr>
                    </td>
                    {PRICE_MATRIX_ROWS.map((m, i) => {
                      const before = p.target?.prices[`${m.paxType}:${m.position}`] ?? null;
                      const after = p.prices[i];
                      const changed = p.target != null && before !== after;
                      // A row with no match has no currency yet: its prices print as plain numbers.
                      const currency = p.target?.currency;
                      return (
                        <td key={m.sheetKey} className="px-2 py-1 text-end tabular-nums">
                          <Ltr>
                            {changed && before != null && (
                              <span className="me-1 text-muted-foreground line-through">{fmtPrice(before, currency)}</span>
                            )}
                            <span className={cn(changed && (after == null ? "font-semibold text-destructive" : "font-semibold text-success"))}>
                              {after == null ? (changed ? "Remove" : EMPTY) : fmtPrice(after, currency)}
                            </span>
                          </Ltr>
                        </td>
                      );
                    })}
                    <td className={cn("px-2 py-1", p.error ? "text-destructive" : "text-success")}>{p.error ?? "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {preview.length > 0 ? `${valid.length} valid rows${invalid ? ` · ${invalid} with errors (won't be applied)` : ""}` : ""}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={saving || valid.length === 0}>
              {saving && <Loader2 className="animate-spin" />}
              Apply {valid.length} Rows
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- copy prices
export function CopyPricesDialog({
  open,
  onOpenChange,
  rows,
  targets,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BoardRow[];
  targets: BoardRow[];
  onApplied: (outcome: BulkOutcome) => void;
}) {
  const [sourceCode, setSourceCode] = useState("");
  const [includeOptions, setIncludeOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const run = useActionToast();

  const candidates = useMemo(
    () => rows.filter((r) => !r.is_deleted && (Object.keys(r.prices).length > 0 || r.options.length > 0)),
    [rows],
  );
  const matches = candidates.filter((r) => r.code === sourceCode.trim().toUpperCase());
  const source = matches.length === 1 ? matches[0] : null;
  const realTargets = targets.filter((t) => t.id !== source?.id);
  const currencyChanges = source ? realTargets.filter((t) => t.currency !== source.currency).length : 0;

  const apply = async () => {
    if (!source) return;
    setSaving(true);
    const result = await run(() =>
      copyDeparturePrices(
        source.id,
        realTargets.map((t) => t.id),
        { includeOptions: includeOptions && source.options.length > 0 },
      ),
    );
    setSaving(false);
    if (!result.success) return;
    onOpenChange(false);
    setSourceCode("");
    onApplied(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pe-8 text-start sm:text-start">
          <DialogTitle>Copy Prices From Another Departure</DialogTitle>
          <DialogDescription>
            The source departure&apos;s price matrix and currency will replace those of the {targets.length} selected departures.
          </DialogDescription>
        </DialogHeader>
        <Field label="Source departure code" hint="Start typing the code of a departure that has prices">
          <Input
            dir="ltr"
            className="h-9 font-mono"
            list="tours-copy-source-codes"
            value={sourceCode}
            onChange={(e) => setSourceCode(e.target.value.toUpperCase())}
            placeholder="CBEA1014"
            autoFocus
          />
          <datalist id="tours-copy-source-codes">
            {candidates.slice(0, 1500).map((r) => (
              <option key={r.id} value={r.code}>
                {fmtDateRange(r.start_date, r.end_date)}
              </option>
            ))}
          </datalist>
        </Field>
        {matches.length > 1 && <Notice tone="error">This code exists in more than one year - filter the board to a single year and try again.</Notice>}
        {sourceCode && matches.length === 0 && <Notice tone="warning">No departure with prices on the board has this code.</Notice>}
        {source && (
          <div className="rounded-md border p-3 text-sm">
            <p className="mb-2 font-medium">
              <Ltr className="font-mono">{source.code}</Ltr> · <Ltr>{fmtDateRange(source.start_date, source.end_date)}</Ltr> ·{" "}
              <Ltr>{source.currency}</Ltr>
            </p>
            {Object.keys(source.prices).length > 0 ? (
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                {PRICE_MATRIX_ROWS.map((m) => (
                  <div key={m.sheetKey} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{m.label}</span>
                    <Ltr className="font-semibold tabular-nums">{fmtPrice(source.prices[`${m.paxType}:${m.position}`], source.currency)}</Ltr>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">This departure has no price matrix (vacation package).</p>
            )}
            {source.options.length > 0 && (
              <CheckField
                className="mt-3"
                checked={includeOptions}
                onCheckedChange={setIncludeOptions}
                label="Also copy hotels, tickets and markup (replaces those of the target departures)"
              />
            )}
          </div>
        )}
        {source && currencyChanges > 0 && (
          <Notice tone="warning">
            The currency of {currencyChanges} of the selected departures will change to <Ltr>{source.currency}</Ltr>.
          </Notice>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!source || saving || realTargets.length === 0}>
            {saving && <Loader2 className="animate-spin" />}
            Copy to {realTargets.length} Departures
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- promotion for the selection
export function BulkPromotionDialog({
  open,
  onOpenChange,
  targets,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: BoardRow[];
  onApplied: (outcome: BulkOutcome) => void;
}) {
  const [draft, setDraft] = useState<PromotionDraft>(emptyPromotionDraft);
  const [replace, setReplace] = useState(true);
  const [saving, setSaving] = useState(false);
  const run = useActionToast();
  const currencies = Array.from(new Set(targets.map((t) => t.currency)));
  const error = promotionDraftError(draft);
  const mixedCurrency = currencies.length > 1 && draft.kind !== "percent_order" && draft.kind !== "gift";

  const apply = async () => {
    setSaving(true);
    const result = await run(() =>
      addPromotionToDepartures(
        targets.map((t) => t.id),
        draftToInput(draft),
        replace,
      ),
    );
    setSaving(false);
    if (!result.success) return;
    onOpenChange(false);
    setDraft(emptyPromotionDraft());
    onApplied(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="pe-8 text-start sm:text-start">
          <DialogTitle>Promotion for {targets.length} Departures</DialogTitle>
          <DialogDescription>The promotion is added to each selected departure.</DialogDescription>
        </DialogHeader>
        <PromotionFields draft={draft} onChange={setDraft} currency={currencies.length === 1 ? currencies[0] : null} />
        <CheckField
          checked={replace}
          onCheckedChange={setReplace}
          label="Replace an active promotion of the same kind"
          hint="The existing one is switched off and the new one takes its place. Unchecked, a departure that already has an active promotion of this kind is skipped."
        />
        {mixedCurrency && (
          <Notice tone="warning">
            The selected departures use different currencies ({currencies.join(", ")}). The amount applies in each departure&apos;s own currency.
          </Notice>
        )}
        <DialogFooter className="sm:justify-between">
          <span className="text-sm text-destructive">{draft.value || draft.label ? error : ""}</span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={saving || Boolean(error)}>
              {saving && <Loader2 className="animate-spin" />}
              Add Promotion
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
