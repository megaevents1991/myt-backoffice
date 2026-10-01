"use client";

/**
 * /tours/rates - the daily exchange rate the company types in by hand
 * (functional spec 5.7): one rate per currency per day, in shekels. When today's
 * rate is missing the screen says so, and the last rate entered stays in force.
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useActionToast } from "@/hooks/use-action-toast";
import { getTourRates, saveTourRate, type TourRateStatus, type TourRatesData } from "@/lib/actions/tours-rates-actions";
import { formatDateShort } from "@/lib/tours/deadlines";
import { parseNumber } from "@/lib/tours/format";
import { Field, Ltr, Notice, Section } from "@/components/tours/ui";

const CURRENCY_NAMES: Record<string, string> = { USD: "דולר", EUR: "אירו", GBP: "לירה שטרלינג" };

const LOAD_FAILED = "טעינת השערים נכשלה. המסך זמין כשהחברה הפעילה מוכרת טיולים.";

const rateText = (rate: number) => rate.toFixed(4).replace(/0{1,2}$/, "");

export function RatesClient() {
  const [data, setData] = useState<TourRatesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getTourRates();
      if (res.success) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("rates: load failed", e);
      setError(LOAD_FAILED);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div dir="rtl">
      <PageHeader
        title="שער יומי"
        description="השער שהחברה מזינה ידנית בכל יום: כמה שקלים שווה יחידה אחת של כל מטבע. כשלא הוזן שער להיום, השער האחרון שהוזן נשאר בתוקף."
      />

      {error && (
        <div className="mb-4 space-y-2">
          <Notice tone="error">{error}</Notice>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            ניסיון נוסף
          </Button>
        </div>
      )}

      {data === null && !error ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : data !== null ? (
        <div className="space-y-4">
          {data.missingToday.length > 0 && (
            <div role="alert">
              <Notice tone="warning">
                <span className="font-semibold">
                  לא הוזן שער להיום (<Ltr>{formatDateShort(data.today)}</Ltr>) עבור: {data.missingToday.join(", ")}.
                </span>{" "}
                עד שיוזן, בתוקף השער האחרון שהוזן לכל מטבע.
              </Notice>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            {data.currencies.map((c) => (
              <RateCard key={c.currency} status={c} today={data.today} onSaved={load} />
            ))}
          </div>

          <Section
            title="היסטוריה"
            description={data.historyTruncated ? `מוצגות ${data.history.length} ההזנות האחרונות.` : undefined}
          >
            {data.history.length === 0 ? (
              <Notice tone="muted">עוד לא הוזן שער.</Notice>
            ) : (
              <Table look="list">
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>מטבע</TableHead>
                    <TableHead>שער לשקל</TableHead>
                    <TableHead>הוזן על ידי</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.history.map((r) => (
                    <TableRow key={`${r.rate_date}:${r.currency}`}>
                      <TableCell>
                        <Ltr>{formatDateShort(r.rate_date)}</Ltr>
                      </TableCell>
                      <TableCell>
                        <Ltr>{r.currency}</Ltr>
                      </TableCell>
                      <TableCell>
                        <Ltr>{rateText(Number(r.rate_to_ils))}</Ltr>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.entered_by_name ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function RateCard({
  status,
  today,
  onSaved,
}: {
  status: TourRateStatus;
  today: string;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(status.today === null ? "" : rateText(status.today));
  const [saving, setSaving] = useState(false);
  const run = useActionToast();
  useEffect(() => setValue(status.today === null ? "" : rateText(status.today)), [status.today]);

  const parsed = parseNumber(value);
  const valid = typeof parsed === "number" && parsed > 0;
  const unchanged = status.today !== null && valid && parsed === status.today;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const res = await run(
      () => saveTourRate({ currency: status.currency, rate: parsed, date: today }),
      `שער ${status.currency} להיום נשמר`,
    );
    if (res.success) await onSaved();
    setSaving(false);
  };

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Ltr>{status.currency}</Ltr>
          <span className="text-sm font-normal text-muted-foreground">{CURRENCY_NAMES[status.currency] ?? ""}</span>
        </span>
      }
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="השער להיום (₪)" htmlFor={`rate-${status.currency}`} className="flex-1">
          <Input
            id={`rate-${status.currency}`}
            dir="ltr"
            inputMode="decimal"
            placeholder={status.inForce ? rateText(status.inForce.rate) : "3.70"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={saving || !valid || unchanged}>
          {saving ? "שומר..." : status.today === null ? "הזנה" : "עדכון"}
        </Button>
      </form>
      <p className="mt-2 text-xs">
        {status.today !== null ? (
          <span className="text-emerald-700 dark:text-emerald-400">הוזן להיום.</span>
        ) : status.inForce ? (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            לא הוזן להיום. בתוקף: <Ltr>{rateText(status.inForce.rate)}</Ltr> מ-
            <Ltr>{formatDateShort(status.inForce.rate_date)}</Ltr>
          </span>
        ) : (
          <span className="font-medium text-destructive">עוד לא הוזן שער למטבע הזה.</span>
        )}
      </p>
    </Section>
  );
}
