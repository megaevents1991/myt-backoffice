"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { deleteFormResponse } from "@/lib/actions/form-response-actions";
import { formatAnswer } from "@/lib/forms/validation";
import { adminLabel } from "@/lib/forms/i18n";
import type { FormField, FormResponseRow } from "@/types/form.types";

const CHART_COLOR = "hsl(var(--primary))";

type Props = {
  formId: number;
  fields: FormField[];
  initialResponses: FormResponseRow[];
};

export function ResponsesClient({ formId, fields, initialResponses }: Props) {
  const { toast } = useToast();
  const [responses, setResponses] = useState(initialResponses);
  const [open, setOpen] = useState<FormResponseRow | null>(null);
  const [pending, startTransition] = useTransition();

  const questions = useMemo(
    () => fields.filter((field) => field.type !== "section"),
    [fields],
  );

  function handleDelete(response: FormResponseRow) {
    startTransition(async () => {
      try {
        await deleteFormResponse(response.id, formId);
        setResponses((prev) => prev.filter((r) => r.id !== response.id));
        setOpen(null);
        toast({ title: "Response deleted" });
      } catch {
        toast({ title: "Could not delete the response", variant: "destructive" });
      }
    });
  }

  const respondent = (response: FormResponseRow) =>
    response.recipient_name || response.recipient_email || "Public link";

  return (
    <Tabs defaultValue="table" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="table">Responses</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <Button variant="outline" asChild disabled={responses.length === 0}>
          <a href={`/api/exports/form-responses?formId=${formId}`}>
            <Download className="mr-2 h-4 w-4" />
            Export .xlsx
          </a>
        </Button>
      </div>

      <TabsContent value="table" className="space-y-0">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Submitted</TableHead>
                <TableHead className="whitespace-nowrap">From</TableHead>
                {questions.map((field) => (
                  <TableHead key={field.id} className="min-w-[160px]">
                    {adminLabel(field.label_en, field.label_he)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {responses.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={questions.length + 2}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No responses yet.
                  </TableCell>
                </TableRow>
              )}

              {responses.map((response) => (
                <TableRow
                  key={response.id}
                  className="cursor-pointer"
                  onClick={() => setOpen(response)}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(response.submitted_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {respondent(response)}
                  </TableCell>
                  {questions.map((field) => (
                    <TableCell key={field.id} className="max-w-[280px] truncate">
                      {formatAnswer(field, response.answers[String(field.id)])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="summary" className="space-y-4">
        {responses.length === 0 && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing to summarise yet.
          </p>
        )}
        {responses.length > 0 &&
          questions.map((field) => (
            <QuestionSummary key={field.id} field={field} responses={responses} />
          ))}
      </TabsContent>

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{open ? respondent(open) : ""}</SheetTitle>
          </SheetHeader>

          {open && (
            <div className="mt-6 space-y-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{new Date(open.submitted_at).toLocaleString()}</span>
                <Badge variant="secondary">{open.lang.toUpperCase()}</Badge>
              </div>

              {questions.map((field) => {
                const value = formatAnswer(field, open.answers[String(field.id)]);
                return (
                  <div key={field.id} className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      {adminLabel(field.label_en, field.label_he)}
                    </div>
                    <div className="whitespace-pre-line text-sm">
                      {value || <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                );
              })}

              <Button
                variant="outline"
                className="text-destructive"
                disabled={pending}
                onClick={() => handleDelete(open)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete this response
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Tabs>
  );
}

function QuestionSummary({
  field,
  responses,
}: {
  field: FormField;
  responses: FormResponseRow[];
}) {
  const answered = responses
    .map((response) => response.answers[String(field.id)])
    .filter((value) => value !== null && value !== undefined && value !== "");

  const isChoice = ["select", "radio", "checkbox", "yes_no"].includes(field.type);
  const isNumeric = ["rating", "scale"].includes(field.type);

  const chartData = useMemo(() => {
    if (isChoice) {
      const buckets = new Map<string, number>();
      if (field.type === "yes_no") {
        buckets.set("Yes", 0);
        buckets.set("No", 0);
      } else {
        for (const option of field.options) {
          buckets.set(adminLabel(option.label_en, option.label_he) || option.value, 0);
        }
      }
      for (const value of answered) {
        const labels =
          field.type === "yes_no"
            ? [value ? "Yes" : "No"]
            : (Array.isArray(value) ? value : [String(value)]).map((raw) => {
                const option = field.options.find((o) => o.value === raw);
                if (!option) return String(raw);
                return adminLabel(option.label_en, option.label_he) || option.value;
              });
        for (const label of labels) buckets.set(label, (buckets.get(label) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([name, count]) => ({ name, count }));
    }

    if (isNumeric) {
      const buckets = new Map<number, number>();
      const min = field.type === "rating" ? 1 : field.config.min ?? 1;
      const max = field.type === "rating" ? field.config.max ?? 5 : field.config.max ?? 10;
      for (let n = min; n <= max; n++) buckets.set(n, 0);
      for (const value of answered) {
        const n = Number(value);
        if (buckets.has(n)) buckets.set(n, (buckets.get(n) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([name, count]) => ({ name: String(name), count }));
    }

    return [];
  }, [answered, field, isChoice, isNumeric]);

  const average = useMemo(() => {
    if (!isNumeric || answered.length === 0) return null;
    const total = answered.reduce((sum: number, value) => sum + Number(value), 0);
    return (total / answered.length).toFixed(1);
  }, [answered, isNumeric]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{adminLabel(field.label_en, field.label_he)}</h3>
        <span className="text-xs text-muted-foreground">
          {answered.length} answered
          {average !== null && ` · average ${average}`}
        </span>
      </div>

      {chartData.length > 0 ? (
        <div className="mt-4 h-[max(140px,var(--chart-h))]" style={{ ["--chart-h" as string]: `${chartData.length * 32}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={{ fill: "hsl(var(--muted))" }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={CHART_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {answered.slice(0, 5).map((value, index) => (
            <li key={index} className="truncate text-muted-foreground">
              {formatAnswer(field, value)}
            </li>
          ))}
          {answered.length === 0 && (
            <li className="text-muted-foreground">No answers yet.</li>
          )}
          {answered.length > 5 && (
            <li className="text-xs text-muted-foreground">
              +{answered.length - 5} more in the Responses tab
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
