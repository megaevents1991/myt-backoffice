"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { createSeriesForm } from "@/lib/actions/form-actions";
import { adminLabel } from "@/lib/forms/i18n";
import { audienceOf } from "@/types/form.types";
import type { FormAudience, FormSeries, FormSummary } from "@/types/form.types";

/**
 * "New series form": copy a base form's questions into a draft tied to one series. The
 * copy is edited on its own afterwards - add the route's hotels, drop what does not fit.
 */
export function NewSeriesFormDialog({
  open,
  onOpenChange,
  forms,
  seriesOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forms: FormSummary[];
  seriesOptions: FormSeries[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // Default base: the newest live form (today #5, the shared trip feedback).
  const defaultBase = useMemo(
    () => forms.find((f) => f.status === "live") ?? forms[0] ?? null,
    [forms],
  );
  const [baseId, setBaseId] = useState<string>(defaultBase ? String(defaultBase.id) : "");
  const [seriesId, setSeriesId] = useState<string>("");
  const [audience, setAudience] = useState<FormAudience>("clients");
  const [questions, setQuestions] = useState<"copy" | "trip_details">("copy");

  const formsOfSeries = (id: string) =>
    forms.filter((f) => f.series_id === id && audienceOf(f) === audience);

  function pickAudience(next: FormAudience) {
    setAudience(next);
    // An escort form rarely wants the travellers' questions - start it from the trip details.
    setQuestions(next === "escorts" ? "trip_details" : "copy");
  }

  function handleCreate() {
    startTransition(async () => {
      try {
        const created = await createSeriesForm(Number(baseId), seriesId, { audience, questions });
        toast({ title: "Series form created as a draft - add its hotels, then set it Live" });
        router.push(`/forms/${created.id}/edit`);
      } catch (error) {
        toast({
          title: "Could not create the series form",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    });
  }

  const taken = seriesId ? formsOfSeries(seriesId) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New series form</DialogTitle>
          <DialogDescription>
            Every trip of the series answers the same questions. The form starts as a copy of
            another one; edit it freely afterwards - the base form is not touched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Who answers</Label>
            <Select value={audience} onValueChange={(next) => pickAudience(next as FormAudience)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clients">The travellers (trip feedback)</SelectItem>
                <SelectItem value="escorts">The escort (escort feedback)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Series</Label>
            <Select value={seriesId} onValueChange={setSeriesId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a series…" />
              </SelectTrigger>
              <SelectContent className="max-h-[50vh]">
                {seriesOptions.map((series) => {
                  const has = formsOfSeries(series.id);
                  return (
                    <SelectItem key={series.id} value={series.id}>
                      <span className="font-mono font-semibold">{series.code}</span>
                      {series.name ? ` · ${series.name}` : ""}
                      {has.length > 0 ? ` (has form #${has.map((f) => f.id).join(", #")})` : ""}
                      {series.is_active ? "" : " - inactive"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {taken.length > 0 && (
              <p className="text-xs text-amber-600">
                This series already has a{audience === "escorts" ? "n escort" : ""} form. A second
                one is allowed (a new season, a new version) - its trip links keep their own report.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Start with</Label>
            <Select value={questions} onValueChange={(next) => setQuestions(next as "copy" | "trip_details")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">All the questions of the form below</SelectItem>
                <SelectItem value="trip_details">
                  Only the trip details (escort, departure date) - I add the questions
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {questions === "copy" ? "Copy the questions and design of" : "Copy the design of"}
            </Label>
            <Select value={baseId} onValueChange={setBaseId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a form…" />
              </SelectTrigger>
              <SelectContent className="max-h-[50vh]">
                {forms.map((form) => (
                  <SelectItem key={form.id} value={String(form.id)}>
                    #{form.id} {adminLabel(form.title_en, form.title_he) || "Untitled form"}
                    {form.series ? ` · ${form.series.code}` : ""} ({form.field_count} questions,{" "}
                    {form.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={pending || !seriesId || !baseId}>
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
