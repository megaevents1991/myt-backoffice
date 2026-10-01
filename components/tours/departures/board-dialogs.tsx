"use client";

/**
 * Dialogs opened from the departures board: a new departure, paste prices from
 * Excel, copy prices from another departure, add a promotion to the selection,
 * and the summary of a bulk action that skipped rows.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { departureRouteLabel } from "@/lib/tours/routes";
import { PRICE_MATRIX_ROWS } from "@/types/tours.types";
import {
  addPromotionToDepartures,
  applyPastedPrices,
  copyDeparturePrices,
  createDeparture,
} from "@/lib/actions/tours-departure-actions";
import {
  addDays,
  departureCode,
  fmtDateRange,
  fmtMoney,
  isIsoDate,
  nightsBetween,
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
import { Chip, DialogActions, Field, Ltr, Notice, selectClass } from "./ui-bits";

const SHORT_MATRIX_LABELS = ["יחיד", "זוגי", "מבוגר 3", "ילד 2", "ילד 3", "ילד 4"];

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
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader className="ps-8 text-start sm:text-start">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {outcome ? `עודכנו ${outcome.done.length} יציאות. ${outcome.skipped.length ? `${outcome.skipped.length} לא עודכנו.` : ""}` : ""}
          </DialogDescription>
        </DialogHeader>
        {outcome && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {outcome.skipped.length > 0 && (
              <Notice tone="error">
                <p className="mb-1 font-semibold">לא עודכנו</p>
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
                <p className="mb-1 font-semibold">עודכנו, עם אזהרה</p>
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
        <DialogActions>
          <Button onClick={onClose}>סגירה</Button>
        </DialogActions>
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
  const packageName = useMemo(() => new Map(packages.map((p) => [p.id, p.name])), [packages]);
  const chosen = series.find((s) => s.id === seriesId);
  const nightsOf = (s: BoardSeries | undefined) => (s ? (s.default_nights ?? typicalNights.get(s.id) ?? null) : null);

  const onStart = (value: string) => {
    setStart(value);
    const nights = nightsOf(chosen);
    if (isIsoDate(value) && nights != null && (!end || end < value)) setEnd(addDays(value, nights));
  };
  const onSeries = (id: string) => {
    setSeriesId(id);
    const nights = nightsOf(series.find((s) => s.id === id));
    if (isIsoDate(start) && nights != null) setEnd(addDays(start, nights));
  };

  const valid = Boolean(chosen && isIsoDate(start) && isIsoDate(end) && end >= start);
  const code = chosen && isIsoDate(start) ? departureCode(chosen.code, start) : "";
  const holidays = valid ? periodsOverlapping(periods, start, end) : [];

  const submit = async () => {
    if (!chosen || !valid) return;
    setSaving(true);
    const result = await createDeparture({ seriesId: chosen.id, start_date: start, end_date: end, season: season || null });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`נוצרה יציאה ${result.data.code} כטיוטה`);
    setStart("");
    setEnd("");
    setSeason("");
    onOpenChange(false);
    onCreated(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader className="ps-8 text-start sm:text-start">
          <DialogTitle>יציאה חדשה</DialogTitle>
          <DialogDescription>
            היציאה נוצרת כטיוטה לא מפורסמת. הקוד נבנה מקוד הסדרה ומתאריך היציאה, והמסלול, המטבע והקיבולת נלקחים מהסדרה.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="סדרה" className="col-span-2">
            <select className={`${selectClass} w-full`} value={seriesId} onChange={(e) => onSeries(e.target.value)}>
              <option value="">בחרו סדרה…</option>
              {series
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.package_id}>
                    {s.code}
                    {s.label ? ` · ${s.label}` : ""} · {s.package_id ? (packageName.get(s.package_id) ?? "") : "אין עמוד באתר"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="תאריך יציאה">
            <Input dir="ltr" type="date" className="h-9" value={start} onChange={(e) => onStart(e.target.value)} />
          </Field>
          <Field label="תאריך חזרה">
            <Input dir="ltr" type="date" className="h-9" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="עונה (לא חובה)" className="col-span-2">
            <Input className="h-9" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="קיץ, פסח, חגי תשרי…" list="tours-season-suggestions" />
          </Field>
        </div>
        {chosen && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                קוד: <Ltr className="font-mono font-semibold">{code || "—"}</Ltr>
                {isIsoDate(start) && <span className="text-muted-foreground"> ({seasonYearOf(start)})</span>}
              </span>
              <span>
                מסלול:{" "}
                <Ltr className="font-mono">{departureRouteLabel(chosen.arrival_airport, chosen.return_airport) || "לא הוגדר בסדרה"}</Ltr>
              </span>
              {valid && <span>לילות: {nightsBetween(start, end)}</span>}
              <span>
                מטבע: <Ltr>{chosen.default_currency}</Ltr>
              </span>
            </div>
            {holidays.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {holidays.map((h) => (
                  <Chip key={h.id} className="border-warning/40 bg-warning-muted text-warning">
                    {periodLabel(h)}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ביטול
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="animate-spin" />}
            יצירת יציאה
          </Button>
        </DialogActions>
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
      if (!error && matches.length === 0) error = "הקוד לא נמצא ביציאות שעל הלוח";
      if (!error && matches.length > 1) error = "הקוד קיים בכמה שנים - סננו את הלוח לשנה אחת";
      if (!error && seen.has(p.code)) error = "הקוד מופיע פעמיים בהדבקה";
      seen.add(p.code);
      const target = !error ? matches[0] : null;
      if (target && target.options.length > 0 && Object.keys(target.prices).length === 0) {
        error = "חבילת נופש - המחיר נקבע ממלון וכרטיס, לא ממטריצה";
      }
      return { ...p, error, target: error ? null : target };
    });
  }, [textValue, byCode]);

  const valid = preview.filter((p) => p.target);
  const invalid = preview.length - valid.length;

  const apply = async () => {
    setSaving(true);
    const result = await applyPastedPrices(valid.map((p) => ({ departureId: p.target!.id, prices: p.prices })));
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setTextValue("");
    onOpenChange(false);
    onApplied(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl">
        <DialogHeader className="ps-8 text-start sm:text-start">
          <DialogTitle>הדבקת מחירים מאקסל</DialogTitle>
          <DialogDescription>
            העתיקו מהגיליון שורות של קוד יציאה ואחריו שש עמודות מחיר, בסדר הזה: {PRICE_MATRIX_ROWS.map((r) => r.label).join(" · ")}. תא ריק מוחק את המחיר
            של אותה שורה.
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
                  <th className="px-2 py-1.5 text-start font-semibold">קוד</th>
                  {SHORT_MATRIX_LABELS.map((l) => (
                    <th key={l} className="px-2 py-1.5 text-end font-semibold">
                      {l}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-start font-semibold">מצב</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={`${p.line}-${p.code}`} className={cn("border-t", p.error && "bg-destructive/5")}>
                    <td className="px-2 py-1 font-mono font-semibold">
                      <Ltr>{p.code || "—"}</Ltr>
                    </td>
                    {PRICE_MATRIX_ROWS.map((m, i) => {
                      const before = p.target?.prices[`${m.paxType}:${m.position}`] ?? null;
                      const after = p.prices[i];
                      const changed = p.target != null && before !== after;
                      return (
                        <td key={m.sheetKey} className="px-2 py-1 text-end tabular-nums">
                          <Ltr>
                            {changed && before != null && <span className="me-1 text-muted-foreground line-through">{fmtMoney(before)}</span>}
                            <span className={cn(changed && (after == null ? "font-semibold text-destructive" : "font-semibold text-success"))}>
                              {after == null ? (changed ? "מחיקה" : "—") : fmtMoney(after)}
                            </span>
                          </Ltr>
                        </td>
                      );
                    })}
                    <td className={cn("px-2 py-1", p.error ? "text-destructive" : "text-success")}>{p.error ?? "תקין"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogActions className="justify-between">
          <span className="text-sm text-muted-foreground">
            {preview.length > 0 ? `${valid.length} שורות תקינות${invalid ? ` · ${invalid} עם שגיאה (לא יוחלו)` : ""}` : ""}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              ביטול
            </Button>
            <Button onClick={apply} disabled={saving || valid.length === 0}>
              {saving && <Loader2 className="animate-spin" />}
              החלת {valid.length} שורות
            </Button>
          </span>
        </DialogActions>
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
    const result = await copyDeparturePrices(
      source.id,
      realTargets.map((t) => t.id),
      { includeOptions: includeOptions && source.options.length > 0 },
    );
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    onOpenChange(false);
    setSourceCode("");
    onApplied(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader className="ps-8 text-start sm:text-start">
          <DialogTitle>העתקת מחירים מיציאה אחרת</DialogTitle>
          <DialogDescription>
            מטריצת המחירים והמטבע של יציאת המקור יחליפו את אלה של {targets.length} היציאות שנבחרו.
          </DialogDescription>
        </DialogHeader>
        <Field label="קוד יציאת המקור" hint="התחילו להקליד קוד של יציאה שיש לה מחירים">
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
        {matches.length > 1 && <Notice tone="error">הקוד קיים בכמה שנים - סננו את הלוח לשנה אחת ונסו שוב.</Notice>}
        {sourceCode && matches.length === 0 && <Notice tone="warning">לא נמצאה על הלוח יציאה עם מחירים בקוד הזה.</Notice>}
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
                    <Ltr className="font-semibold tabular-nums">{fmtMoney(source.prices[`${m.paxType}:${m.position}`]) || "—"}</Ltr>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">ליציאה אין מטריצת מחירים (חבילת נופש).</p>
            )}
            {source.options.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={includeOptions}
                  onChange={(e) => setIncludeOptions(e.target.checked)}
                />
                להעתיק גם מלונות, כרטיסים ו-markup (מחליף את אלה של יציאות היעד)
              </label>
            )}
          </div>
        )}
        {source && currencyChanges > 0 && (
          <Notice tone="warning">
            ב-{currencyChanges} מהיציאות שנבחרו המטבע ישתנה ל-<Ltr>{source.currency}</Ltr>.
          </Notice>
        )}
        <DialogActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ביטול
          </Button>
          <Button onClick={apply} disabled={!source || saving || realTargets.length === 0}>
            {saving && <Loader2 className="animate-spin" />}
            העתקה ל-{realTargets.length} יציאות
          </Button>
        </DialogActions>
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
  const currencies = Array.from(new Set(targets.map((t) => t.currency)));
  const error = promotionDraftError(draft);
  const mixedCurrency = currencies.length > 1 && draft.kind !== "percent_order" && draft.kind !== "gift";

  const apply = async () => {
    setSaving(true);
    const result = await addPromotionToDepartures(
      targets.map((t) => t.id),
      draftToInput(draft),
      replace,
    );
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    onOpenChange(false);
    setDraft(emptyPromotionDraft());
    onApplied(result.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader className="ps-8 text-start sm:text-start">
          <DialogTitle>הטבה ל-{targets.length} יציאות</DialogTitle>
          <DialogDescription>ההטבה תתווסף לכל אחת מהיציאות שנבחרו.</DialogDescription>
        </DialogHeader>
        <PromotionFields draft={draft} onChange={setDraft} currency={currencies.length === 1 ? currencies[0] : null} />
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          <span>
            להחליף הטבה פעילה מאותו סוג
            <span className="block text-xs text-muted-foreground">
              ההטבה הקיימת תכובה והחדשה תיכנס במקומה. בלי הסימון, יציאה שכבר יש לה הטבה פעילה מהסוג הזה תדולג.
            </span>
          </span>
        </label>
        {mixedCurrency && (
          <Notice tone="warning">
            היציאות שנבחרו הן במטבעות שונים ({currencies.join(", ")}). הסכום יחול בכל יציאה במטבע שלה.
          </Notice>
        )}
        <DialogActions className="justify-between">
          <span className="text-sm text-destructive">{draft.value || draft.label ? error : ""}</span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              ביטול
            </Button>
            <Button onClick={apply} disabled={saving || Boolean(error)}>
              {saving && <Loader2 className="animate-spin" />}
              הוספת ההטבה
            </Button>
          </span>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
