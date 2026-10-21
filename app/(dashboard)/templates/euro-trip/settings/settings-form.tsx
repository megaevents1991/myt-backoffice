"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { saveItinerarySettings } from "@/lib/actions/itinerary-settings-actions";
import {
  ITINERARY_SPEC_BY_FIELD,
  validateItinerarySettings,
  type ItineraryBoolField,
  type ItineraryFieldErrors,
  type ItineraryNumField,
  type ItinerarySettings,
} from "@/lib/itinerary/settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type FormState = Record<ItineraryBoolField, boolean> & Record<ItineraryNumField, string>;

const toForm = (s: ItinerarySettings): FormState => ({
  enabled: s.enabled,
  paymentsEnabled: s.paymentsEnabled,
  tier2Pct: String(s.tier2Pct),
  tier3Pct: String(s.tier3Pct),
  maxEvents: String(s.maxEvents),
  maxKm: String(s.maxKm),
  bestKm: String(s.bestKm),
  okGapDays: String(s.okGapDays),
  maxGapDays: String(s.maxGapDays),
  maxSpanDays: String(s.maxSpanDays),
  maxAutoRoutes: String(s.maxAutoRoutes),
});

/** The typed form as the action wants it. A blank or unreadable number becomes NaN, which the check refuses. */
const toSettings = (f: FormState): Record<keyof ItinerarySettings, boolean | number> => {
  const n = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));
  return {
    enabled: f.enabled,
    paymentsEnabled: f.paymentsEnabled,
    tier2Pct: n(f.tier2Pct),
    tier3Pct: n(f.tier3Pct),
    maxEvents: n(f.maxEvents),
    maxKm: n(f.maxKm),
    bestKm: n(f.bestKm),
    okGapDays: n(f.okGapDays),
    maxGapDays: n(f.maxGapDays),
    maxSpanDays: n(f.maxSpanDays),
    maxAutoRoutes: n(f.maxAutoRoutes),
  };
};

const SWITCHES: { field: ItineraryBoolField; help: string }[] = [
  { field: "enabled", help: "כבוי = העמודים לא קיימים בייצור; בפריוויו תמיד פעיל" },
  { field: "paymentsEnabled", help: "כבוי = לקוחות שומרים טריפ ל-24 שעות בלבד" },
];

const DISCOUNTS: { field: ItineraryNumField; help: string }[] = [
  {
    field: "tier2Pct",
    help: "האירוע עם דמי השירות הגבוהים בטריפ משלם מלא; השני בגובה דמי השירות מקבל הנחה זו. 0 = בלי הנחה",
  },
  {
    field: "tier3Pct",
    help: "האירוע השלישי בגובה דמי השירות. לא יכול להיות קטן מההנחה על האירוע השני",
  },
];

const RULES: { field: ItineraryNumField; help: string }[] = [
  { field: "maxEvents", help: "2 או 3 אירועים בטריפ אחד" },
  { field: "maxKm", help: "רחוק מזה בין שני אירועים סמוכים בטריפ - האירוע נחסם ('N ק״מ מ-X - רחוק מדי')" },
  { field: "bestKm", help: "עד מרחק זה (ובפער של עד 3 ימים) הצמד מסומן 'מומלץ'. לא יכול לעלות על המרחק המקסימלי" },
  { field: "okGapDays", help: "עד כמה ימים בין שני אירועים זה פער נוח. מעבר לזה זה עדיין אפשרי, עם התווית 'פער ארוך'" },
  { field: "maxGapDays", help: "יותר ימים מזה בין שני אירועים סמוכים - נחסם. לא יכול לעלות על אורך הטריפ" },
  { field: "maxSpanDays", help: "מהאירוע הראשון עד האחרון בטריפ" },
  { field: "maxAutoRoutes", help: "כמה טריפים מוכנים העמוד בונה בעצמו. 0 = העמוד לא בונה מסלולים בעצמו" },
];

const rangeHint = (field: ItineraryNumField): string => {
  const spec = ITINERARY_SPEC_BY_FIELD[field];
  return spec.kind === "num" ? `טווח ${spec.min}-${spec.max}${spec.int ? ", מספר שלם" : ""}` : "";
};

function NumberField({
  field,
  help,
  value,
  error,
  onChange,
}: {
  field: ItineraryNumField;
  help: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const spec = ITINERARY_SPEC_BY_FIELD[field];
  if (spec.kind !== "num") return null;
  const id = `euro-${field}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{spec.label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        dir="ltr"
        className="max-w-[10rem] text-right"
        min={spec.min}
        max={spec.max}
        step={spec.int ? 1 : "any"}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {help} <span className="whitespace-nowrap">({rangeHint(field)})</span>
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** The settings of "Build Your Euro Trip": two switches, the two discounts, the route rules. Settings in, so it renders without a load. */
export function EuroTripSettingsForm({ initial, saved }: { initial: ItinerarySettings; saved: boolean }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [errors, setErrors] = useState<ItineraryFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const [saving, setSaving] = useState(false);

  /** A change clears that field's message (and the save-level ones) - the next Save re-checks everything. */
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setServerError(null);
    setWarning(null);
  };

  async function save() {
    setServerError(null);
    setWarning(null);
    const payload = toSettings(form);
    const checked = validateItinerarySettings(payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      toast({ variant: "destructive", title: "יש שדות לתיקון", description: "ההגדרות לא נשמרו" });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await saveItinerarySettings(payload);
      if ("error" in res) {
        if (res.fieldErrors) setErrors(res.fieldErrors);
        setServerError(res.error);
        toast({ variant: "destructive", title: "השמירה נכשלה", description: res.error });
        return;
      }
      setSavedOnce(true);
      if (res.warning) {
        setWarning(res.warning);
        toast({ variant: "destructive", title: "נשמר, אבל האתר לא התרענן", description: res.warning });
      } else {
        toast({ title: "ההגדרות נשמרו", description: "האתר התרענן" });
      }
    } catch (e) {
      console.error("saveItinerarySettings failed", e);
      const message = e instanceof Error ? e.message : "שגיאה לא צפויה";
      setServerError(message);
      toast({ variant: "destructive", title: "השמירה נכשלה", description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      {!saved && !savedOnce && (
        <Alert>
          <AlertTitle>עוד לא נשמרו הגדרות</AlertTitle>
          <AlertDescription>מוצגות ברירות המחדל - Euro Trip כבוי באתר עד שמפעילים אותו כאן ושומרים.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">מתגים</CardTitle>
          <CardDescription>מה פתוח ללקוחות.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {SWITCHES.map(({ field, help }) => {
            const spec = ITINERARY_SPEC_BY_FIELD[field];
            const id = `euro-${field}`;
            return (
              <div key={field} className="space-y-1.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor={id}>{spec.label}</Label>
                    <p id={`${id}-help`} className="text-xs text-muted-foreground">
                      {help}
                    </p>
                  </div>
                  <Switch
                    id={id}
                    checked={form[field]}
                    aria-describedby={`${id}-help`}
                    onCheckedChange={(v) => set(field, v)}
                  />
                </div>
                {errors[field] && <p className="text-sm text-destructive">{errors[field]}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הנחות על דמי השירות</CardTitle>
          <CardDescription>
            הנחה על דמי השירות (המארקאפ) של האירוע השני והשלישי בטריפ. הכרטיס, הטיסה והמלון נשארים במחירם.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {DISCOUNTS.map(({ field, help }) => (
            <NumberField
              key={field}
              field={field}
              help={help}
              value={form[field]}
              error={errors[field]}
              onChange={(v) => set(field, v)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">כללי מסלול</CardTitle>
          <CardDescription>
            {"אילו אירועים אפשר לשלב באותו טריפ, ואיזה מהם האתר מציג כ'מומלץ' או כ'פער ארוך'."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {RULES.map(({ field, help }) => (
            <NumberField
              key={field}
              field={field}
              help={help}
              value={form[field]}
              error={errors[field]}
              onChange={(v) => set(field, v)}
            />
          ))}
        </CardContent>
      </Card>

      {serverError && (
        <Alert variant="destructive">
          <AlertTitle>השמירה נכשלה</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      {warning && (
        <Alert>
          <AlertTitle>נשמר, אבל האתר לא התרענן</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}

      <Button onClick={save} disabled={saving}>
        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
        שמירה
      </Button>
    </div>
  );
}
