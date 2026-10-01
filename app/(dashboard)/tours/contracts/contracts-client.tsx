"use client";

/**
 * /tours/contracts - the airline contracts of the company (functional spec 5.6).
 * A contract gives the day offsets that the deadlines of a flight block are
 * computed from, and keeps the original wording next to them.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  listTourContracts,
  saveTourContract,
  type TourContractInput,
  type TourContractRow,
} from "@/lib/actions/tours-contract-actions";
import { formatDateShort } from "@/lib/tours/deadlines";
import { CURRENCIES } from "@/types/tours.types";
import {
  Field,
  Ltr,
  Notice,
  RtlDialogContent,
  RtlDialogFooter,
  RtlDialogHeader,
  Section,
  formatMoney,
  parseNumber,
} from "@/components/tours/flights/block-ui";
import { COMMITMENT_UNIT_LABELS, CONTRACT_KIND_LABELS } from "@/components/tours/flights/block-contract-costs";

/** The row that holds the original conditions document of the company (from the import). */
const SOURCE_TERMS_CONTRACT_NAME = "תנאי ביטול והתחייבות (מסמך מקור)";
const NO_UNIT = "__none__";

const LOAD_FAILED = "טעינת החוזים נכשלה. המסך זמין כשהחברה הפעילה מוכרת טיולים.";

export function ContractsClient() {
  const [rows, setRows] = useState<TourContractRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** `"new"` = the create form, a row = the edit form of that contract. */
  const [editing, setEditing] = useState<TourContractRow | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listTourContracts();
      if (res.success) {
        setRows(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("contracts: load failed", e);
      setError(LOAD_FAILED);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const source = rows?.find((r) => r.name === SOURCE_TERMS_CONTRACT_NAME) ?? null;
  const contracts = rows?.filter((r) => r.name !== SOURCE_TERMS_CONTRACT_NAME) ?? [];

  return (
    <div dir="rtl">
      <PageHeader
        title="חוזי טיסה"
        description="החוזים מול חברות התעופה. ימי הביטול, השמות והכרטוס של חוזה קובעים את המועדים של כל בלוק שמשויך אליו. שינוי ימים כאן לא מזיז מועדים שכבר נקבעו בבלוקים."
        actions={<Button onClick={() => setEditing("new")}>חוזה חדש</Button>}
      />

      {error && (
        <div className="mb-4 space-y-2">
          <Notice tone="danger">{error}</Notice>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            ניסיון נוסף
          </Button>
        </div>
      )}

      {rows === null && !error ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows !== null ? (
        <div className="space-y-4">
          {contracts.length === 0 ? (
            <Notice>עוד אין חוזים. הוסיפו את החוזה הראשון כדי שמועדי הבלוקים יחושבו ממנו.</Notice>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table look="list">
                <TableHeader>
                  <TableRow>
                    <TableHead>שם</TableHead>
                    <TableHead>קבוצת חברות</TableHead>
                    <TableHead>סוג</TableHead>
                    <TableHead>תוקף</TableHead>
                    <TableHead>ביטול ראשון</TableHead>
                    <TableHead>ביטול אחרון</TableHead>
                    <TableHead>שמות</TableHead>
                    <TableHead>כרטוס</TableHead>
                    <TableHead>התחייבות</TableHead>
                    <TableHead>שינוי שם</TableHead>
                    <TableHead>בלוקים</TableHead>
                    <TableHead>מצב</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.map((c) => (
                    <TableRow key={c.id} className={c.is_active ? undefined : "text-muted-foreground"}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.airline_group ? <Ltr>{c.airline_group}</Ltr> : "-"}</TableCell>
                      <TableCell>{CONTRACT_KIND_LABELS[c.kind] ?? c.kind}</TableCell>
                      <TableCell>
                        {c.valid_from || c.valid_to ? (
                          <Ltr>
                            {formatDateShort(c.valid_from) || "..."} - {formatDateShort(c.valid_to) || "..."}
                          </Ltr>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{c.cxx1_days_before}</TableCell>
                      <TableCell className="tabular-nums">{c.cxx2_days_before}</TableCell>
                      <TableCell className="tabular-nums">{c.names_days_before ?? "-"}</TableCell>
                      <TableCell className="tabular-nums">{c.ticketing_days_before ?? "-"}</TableCell>
                      <TableCell>
                        {c.commitment_amount === null ? (
                          "-"
                        ) : (
                          <>
                            <Ltr>
                              {c.commitment_unit === "pct_of_fare"
                                ? `${c.commitment_amount}%`
                                : formatMoney(c.commitment_amount, c.currency)}
                            </Ltr>{" "}
                            {c.commitment_unit ? (COMMITMENT_UNIT_LABELS[c.commitment_unit] ?? "") : ""}
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.name_change_fee === null ? "-" : <Ltr>{formatMoney(c.name_change_fee, c.currency)}</Ltr>}
                      </TableCell>
                      <TableCell className="tabular-nums">{c.blocks_count}</TableCell>
                      <TableCell>
                        <Badge variant={c.is_active ? "secondary" : "outline"}>{c.is_active ? "פעיל" : "לא פעיל"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          עריכה
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">הימים בטבלה הם ימים לפני יציאת הטיסה.</p>

          {source && (
            <Section
              title="תנאי ביטול והתחייבות (מסמך מקור)"
              description="הנוסח המקורי של תנאי חברות התעופה, כפי שנטען מקובץ התפעול. מוצג ליד כל עדכון מושבים בבלוק שלחוזה שלו אין נוסח משלו."
              actions={
                <Button size="sm" variant="outline" onClick={() => setEditing(source)}>
                  עריכת הנוסח
                </Button>
              }
            >
              {source.terms_text?.trim() ? (
                <div
                  className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-7 [unicode-bidi:plaintext] text-right"
                >
                  {source.terms_text}
                </div>
              ) : (
                <Notice>המסמך ריק.</Notice>
              )}
            </Section>
          )}
        </div>
      ) : null}

      {editing && (
        <ContractDialog
          contract={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function ContractDialog({
  contract,
  onClose,
  onSaved,
}: {
  contract: TourContractRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(contract?.name ?? "");
  const [airlineGroup, setAirlineGroup] = useState(contract?.airline_group ?? "");
  const [kind, setKind] = useState(contract?.kind ?? "series_contract");
  const [validFrom, setValidFrom] = useState(contract?.valid_from ?? "");
  const [validTo, setValidTo] = useState(contract?.valid_to ?? "");
  const [cxx1, setCxx1] = useState(text(contract?.cxx1_days_before ?? 45));
  const [cxx2, setCxx2] = useState(text(contract?.cxx2_days_before ?? 31));
  const [names, setNames] = useState(text(contract?.names_days_before));
  const [ticketing, setTicketing] = useState(text(contract?.ticketing_days_before));
  const [commitment, setCommitment] = useState(text(contract?.commitment_amount));
  const [unit, setUnit] = useState(contract?.commitment_unit ?? NO_UNIT);
  const [nameChangeFee, setNameChangeFee] = useState(text(contract?.name_change_fee));
  const [currency, setCurrency] = useState(contract?.currency ?? "USD");
  const [terms, setTerms] = useState(contract?.terms_text ?? "");
  const [active, setActive] = useState(contract?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSource = contract?.name === SOURCE_TERMS_CONTRACT_NAME;

  const submit = async () => {
    const numbers = {
      cxx1: parseNumber(cxx1),
      cxx2: parseNumber(cxx2),
      names: parseNumber(names),
      ticketing: parseNumber(ticketing),
      commitment: parseNumber(commitment),
      nameChangeFee: parseNumber(nameChangeFee),
    };
    if (Object.values(numbers).some((v) => v === undefined)) {
      setError("בשדות המספר יש ערך שאינו מספר");
      return;
    }
    if (typeof numbers.cxx1 !== "number" || typeof numbers.cxx2 !== "number") {
      setError("ימי ביטול ראשון ואחרון הם שדות חובה");
      return;
    }
    const input: TourContractInput = {
      ...(contract ? { id: contract.id } : {}),
      name,
      airline_group: airlineGroup || null,
      kind,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      cxx1_days_before: numbers.cxx1,
      cxx2_days_before: numbers.cxx2,
      names_days_before: numbers.names ?? null,
      ticketing_days_before: numbers.ticketing ?? null,
      commitment_amount: numbers.commitment ?? null,
      commitment_unit: unit === NO_UNIT ? null : unit,
      name_change_fee: numbers.nameChangeFee ?? null,
      currency,
      terms_text: terms || null,
      is_active: active,
    };
    setSaving(true);
    setError(null);
    try {
      const res = await saveTourContract(input);
      if (!res.success) {
        setError(res.error);
        return;
      }
      toast.success(contract ? "החוזה עודכן" : "החוזה נוצר");
      await onSaved();
    } catch (e) {
      console.error("contracts: save failed", e);
      setError("השמירה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RtlDialogContent className="sm:max-w-2xl">
        <RtlDialogHeader>
          <DialogTitle>{contract ? `עריכת חוזה: ${contract.name}` : "חוזה חדש"}</DialogTitle>
          <DialogDescription>
            {contract && contract.blocks_count > 0
              ? `${contract.blocks_count} בלוקים משויכים לחוזה. שינוי הימים לא מזיז את המועדים שלהם; בכל בלוק אפשר לחשב מחדש מהחוזה.`
              : "הימים הם ימים לפני יציאת הטיסה."}
          </DialogDescription>
        </RtlDialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="שם" htmlFor="contract-name">
              <Input id="contract-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSource} />
            </Field>
            <Field label="קבוצת חברות תעופה" htmlFor="contract-airline" hint="למשל LY, LH GROUP, AF/KL">
              <Input
                id="contract-airline"
                dir="ltr"
                value={airlineGroup}
                onChange={(e) => setAirlineGroup(e.target.value)}
              />
            </Field>
            <Field label="סוג">
              <Select dir="rtl" value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONTRACT_KIND_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="מטבע">
              <Select dir="rtl" value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="בתוקף מ" htmlFor="contract-from">
              <Input id="contract-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label="בתוקף עד" htmlFor="contract-to">
              <Input id="contract-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="ביטול ראשון (ימים)" htmlFor="contract-cxx1">
              <Input id="contract-cxx1" dir="ltr" inputMode="numeric" value={cxx1} onChange={(e) => setCxx1(e.target.value)} />
            </Field>
            <Field label="ביטול אחרון (ימים)" htmlFor="contract-cxx2">
              <Input id="contract-cxx2" dir="ltr" inputMode="numeric" value={cxx2} onChange={(e) => setCxx2(e.target.value)} />
            </Field>
            <Field label="שמות (ימים)" htmlFor="contract-names">
              <Input id="contract-names" dir="ltr" inputMode="numeric" value={names} onChange={(e) => setNames(e.target.value)} />
            </Field>
            <Field label="כרטוס (ימים)" htmlFor="contract-ticketing">
              <Input
                id="contract-ticketing"
                dir="ltr"
                inputMode="numeric"
                value={ticketing}
                onChange={(e) => setTicketing(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="התחייבות" htmlFor="contract-commitment">
              <Input
                id="contract-commitment"
                dir="ltr"
                inputMode="decimal"
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
              />
            </Field>
            <Field label="יחידת ההתחייבות">
              <Select dir="rtl" value={unit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_UNIT}>לא הוגדר</SelectItem>
                  {Object.entries(COMMITMENT_UNIT_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="עלות שינוי שם" htmlFor="contract-name-fee">
              <Input
                id="contract-name-fee"
                dir="ltr"
                inputMode="decimal"
                value={nameChangeFee}
                onChange={(e) => setNameChangeFee(e.target.value)}
              />
            </Field>
          </div>

          <Field label="נוסח מקורי" htmlFor="contract-terms" hint="הנוסח כפי שהתקבל מחברת התעופה, בלי עריכה.">
            <Textarea id="contract-terms" rows={8} className="[unicode-bidi:plaintext] text-right" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            חוזה פעיל (מוצע לבחירה בבלוקים)
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <RtlDialogFooter>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}
