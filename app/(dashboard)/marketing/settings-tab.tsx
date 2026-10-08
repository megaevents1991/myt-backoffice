"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Loader2, RefreshCw, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  getMarketingSettingsPage,
  listCampaignBrands,
  runMarketingSyncNow,
  saveMarketingSettings,
  setCampaignBrand,
} from "@/lib/actions/marketing-actions";
import { SETTING_BOUNDS } from "@/lib/marketing/settings";
import type { MarketingSyncSummary } from "@/lib/services/marketing-sync";
import type { AdBrand, AdPlatform, MarketingSettings } from "@/types/marketing.types";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BRAND_LABEL, PLATFORM_LABEL, errorText } from "./marketing-shared";

type NumKey = Exclude<keyof MarketingSettings, "alert_emails">;
type FormState = Record<NumKey | "alert_emails", string>;

const NUM_FIELDS: { key: NumKey; label: string; hint: string }[] = [
  { key: "processing_fee_pct", label: "עמלת סליקה (%)", hint: "מההכנסה, יורדת מהרווח" },
  { key: "monthly_profit_target_usd", label: "יעד רווח חודשי ($)", hint: "0 = לא הוגדר" },
  { key: "budget_bleed_ils", label: "דימום תקציב - סכום (₪)", hint: "הוצאה בלי רכישה אחת" },
  { key: "budget_bleed_days", label: "דימום תקציב - ימים", hint: "החלון שבו סופרים את ההוצאה" },
  { key: "viral_pct", label: "ויראלי - % מהממוצע", hint: "200 = פי שניים מהמעורבות הרגילה" },
];

const toForm = (s: MarketingSettings): FormState => ({
  processing_fee_pct: String(s.processing_fee_pct),
  monthly_profit_target_usd: String(s.monthly_profit_target_usd),
  budget_bleed_ils: String(s.budget_bleed_ils),
  budget_bleed_days: String(s.budget_bleed_days),
  viral_pct: String(s.viral_pct),
  alert_emails: s.alert_emails.join(", "),
});

/** A number the server would accept (finite, 0 or more); null = say so instead of sending it. */
function parseNum(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The six inputs and "שמירה". Settings in, so it can be rendered without a load. */
export function SettingsFormView({ initial }: { initial: MarketingSettings }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [saving, setSaving] = useState(false);

  async function save() {
    const nums = {} as Record<NumKey, number>;
    for (const f of NUM_FIELDS) {
      const n = parseNum(form[f.key]);
      if (n === null) {
        toast({ variant: "destructive", title: "ערך לא תקין", description: `${f.label}: מספר 0 ומעלה` });
        return;
      }
      nums[f.key] = n;
    }
    const alert_emails = form.alert_emails.split(",").map((e) => e.trim()).filter(Boolean);
    setSaving(true);
    try {
      const res = await saveMarketingSettings({ ...nums, alert_emails });
      if (res.ok) toast({ title: "ההגדרות נשמרו" });
      else toast({ variant: "destructive", title: "השמירה נכשלה", description: res.error ?? "שגיאה" });
    } catch (e) {
      console.error("saveMarketingSettings failed", e);
      toast({ variant: "destructive", title: "השמירה נכשלה", description: errorText(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {NUM_FIELDS.map((f) => (
          <div key={f.key} dir="rtl" className="space-y-1.5">
            <Label htmlFor={`mk-${f.key}`}>{f.label}</Label>
            <Input
              id={`mk-${f.key}`}
              type="number"
              inputMode="decimal"
              min={SETTING_BOUNDS[f.key].min}
              max={SETTING_BOUNDS[f.key].max}
              step={SETTING_BOUNDS[f.key].integer ? 1 : "any"}
              dir="ltr"
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}
        <div dir="rtl" className="space-y-1.5 md:col-span-3">
          <Label htmlFor="mk-alert_emails">מיילים להתראות</Label>
          <Input
            id="mk-alert_emails"
            dir="ltr"
            placeholder="a@example.com, b@example.com"
            value={form.alert_emails}
            onChange={(e) => setForm({ ...form, alert_emails: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">מופרדים בפסיק. ריק = ברירת המחדל של המערכת.</p>
        </div>
      </div>
      <Button onClick={save} disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        שמירה
      </Button>
    </div>
  );
}

function SettingsForm({ initial, error }: { initial: MarketingSettings | null; error: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle dir="rtl" className="text-base">
          הגדרות
        </CardTitle>
        <CardDescription dir="rtl">הספים של ההתראות, עמלת הסליקה ויעד הרווח.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !initial ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <SettingsFormView initial={initial} />
        )}
      </CardContent>
    </Card>
  );
}

function SyncNow({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<MarketingSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await runMarketingSyncNow();
      setSummary(result);
      const failed = result.steps.filter((s) => !s.ok).length;
      toast(
        failed === 0
          ? { title: "הסנכרון הסתיים" }
          : { variant: "destructive", title: "הסנכרון הסתיים עם שגיאות", description: `${failed} שלבים נכשלו` },
      );
      // The sync may have brought new campaigns (or re-derived a rule brand) - refresh the brand table below in place.
      onDone();
    } catch (e) {
      console.error("runMarketingSyncNow failed", e);
      setError(errorText(e));
      toast({ variant: "destructive", title: "הסנכרון נכשל", description: errorText(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle dir="rtl" className="text-base">
          סנכרון
        </CardTitle>
        <CardDescription dir="rtl">
          הסנכרון רץ לבד כל שש שעות. כאן אפשר להריץ אותו עכשיו (עד כמה דקות).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" onClick={run} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          סנכרן עכשיו
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {summary && (
          <ul className="divide-y rounded-md border text-sm">
            {summary.steps.map((s) => (
              <li key={s.step} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-24 font-mono text-xs">{s.step}</span>
                {s.ok ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="הצליח" />
                ) : (
                  <X className="h-4 w-4 text-destructive" aria-label="נכשל" />
                )}
                <span className="tabular-nums text-muted-foreground">{s.rows} שורות</span>
                <span dir="auto" className={cn("min-w-0 flex-1", !s.ok && "text-destructive")}>
                  {s.note}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{(s.ms / 1000).toFixed(1)}s</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type CampaignBrandRow = Awaited<ReturnType<typeof listCampaignBrands>>[number];
type BrandChoice = AdBrand | "rule";
const CHOICE_LABEL: Record<BrandChoice, string> = {
  mega_events: "Mega Events",
  other: "אחר",
  rule: "לפי חוק",
};
const isChoice = (v: string): v is BrandChoice => v === "mega_events" || v === "other" || v === "rule";
const rowKey = (r: { platform: AdPlatform; id: string }) => `${r.platform}:${r.id}`;

/** The campaign table with a brand Select per row. Rows in, so it can be rendered without a load. */
export function CampaignBrandsView({ initial }: { initial: CampaignBrandRow[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<CampaignBrandRow[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  // A fresh list from the parent (the reload after "סנכרן עכשיו") replaces the rows in place - the table keeps its
  // search / page. Adjusted during render, not in an effect (react.dev "adjusting state when a prop changes").
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setRows(initial);
  }

  const choose = useCallback(
    async (row: CampaignBrandRow, choice: BrandChoice) => {
      const key = rowKey(row);
      setSaving(key);
      try {
        const res = await setCampaignBrand(row.platform, row.id, choice);
        if (!res.ok) {
          toast({ variant: "destructive", title: "השמירה נכשלה", description: res.error ?? "שגיאה" });
          return;
        }
        // "By rule" keeps today's brand until the next sync re-derives it; a pick sets it at once.
        setRows((cur) =>
          cur.map((r) =>
            rowKey(r) !== key
              ? r
              : choice === "rule"
                ? { ...r, brand_source: "rule" }
                : { ...r, brand: choice, brand_source: "manual" },
          ),
        );
        toast({ title: "המותג עודכן", description: `${row.name}: ${CHOICE_LABEL[choice]}` });
      } catch (e) {
        console.error("setCampaignBrand failed", e);
        toast({ variant: "destructive", title: "השמירה נכשלה", description: errorText(e) });
      } finally {
        setSaving(null);
      }
    },
    [toast],
  );

  const columns = useMemo<ColumnDef<CampaignBrandRow>[]>(
    () => [
      {
        id: "platform",
        accessorFn: (r) => r.platform,
        header: "פלטפורמה",
        cell: ({ row }) => (
          <Badge variant={row.original.platform === "meta" ? "secondary" : "outline"}>
            {PLATFORM_LABEL[row.original.platform]}
          </Badge>
        ),
      },
      {
        id: "name",
        accessorKey: "name",
        header: "קמפיין",
        cell: ({ row }) => (
          <span dir="auto" className="block max-w-[28rem] truncate font-medium" title={row.original.name}>
            {row.original.name}
          </span>
        ),
      },
      {
        id: "brand",
        accessorFn: (r) => r.brand,
        header: "מותג עכשיו",
        cell: ({ row }) => BRAND_LABEL[row.original.brand],
      },
      {
        id: "actions",
        header: "שיוך",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          const value: BrandChoice = r.brand_source === "manual" ? r.brand : "rule";
          return (
            <Select
              value={value}
              disabled={saving === rowKey(r)}
              onValueChange={(v) => {
                if (isChoice(v) && v !== value) void choose(r, v);
              }}
            >
              <SelectTrigger className="h-8 w-[150px]" aria-label={`מותג של ${r.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CHOICE_LABEL) as BrandChoice[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHOICE_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
    ],
    [choose, saving],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchColumns={["name"]}
      searchPlaceholder="חיפוש קמפיין..."
      getRowId={rowKey}
      defaultPageSize={25}
      emptyState={{
        title: "אין קמפיינים עדיין",
        description: "הם יופיעו אחרי הסנכרון הראשון.",
      }}
      dense
    />
  );
}

function CampaignBrands({ rows, error }: { rows: CampaignBrandRow[] | null; error: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle dir="rtl" className="text-base">
          שיוך קמפיינים למותג
        </CardTitle>
        <CardDescription dir="rtl">
          &quot;לפי חוק&quot; = המערכת מחליטה לפי כתובת הנחיתה והתגיות. בחירה ידנית גוברת עד שתחזרו ל&quot;לפי חוק&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !rows ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <CampaignBrandsView initial={rows} />
        )}
      </CardContent>
    </Card>
  );
}

type SettingsPage = Awaited<ReturnType<typeof getMarketingSettingsPage>>;

export function SettingsTab() {
  const { toast } = useToast();
  const [page, setPage] = useState<SettingsPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ONE action on mount (settings + campaign brands, read side by side on the server): Next runs a tab's server
  // actions one at a time, so two loads would wait on each other.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const loaded = await getMarketingSettingsPage();
        if (!cancelled) setPage(loaded);
      } catch (e) {
        console.error("Error loading the marketing settings:", e);
        if (!cancelled) setError(errorText(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadBrands = useCallback(async () => {
    try {
      const brands = await listCampaignBrands();
      setPage((cur) => (cur ? { ...cur, brands } : cur));
    } catch (e) {
      console.error("Error reloading the campaign brands:", e);
      toast({ variant: "destructive", title: "רשימת הקמפיינים לא רועננה", description: errorText(e) });
    }
  }, [toast]);

  return (
    <div className="space-y-4">
      <SettingsForm initial={page?.settings ?? null} error={error} />
      <SyncNow onDone={() => void reloadBrands()} />
      <CampaignBrands rows={page?.brands ?? null} error={error} />
    </div>
  );
}
