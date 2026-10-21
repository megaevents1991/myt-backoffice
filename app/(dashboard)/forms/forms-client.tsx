"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  BedDouble,
  Copy,
  Layers,
  Link2,
  Map,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { createForm, duplicateForm, softDeleteForm } from "@/lib/actions/form-actions";
import { adminLabel } from "@/lib/forms/i18n";
import type { FormSeries, FormStatus, FormSummary } from "@/types/form.types";
import { NewSeriesFormDialog } from "./new-series-form-dialog";

const STATUS_VARIANT: Record<FormStatus, "default" | "secondary" | "outline"> = {
  live: "default",
  draft: "secondary",
  closed: "outline",
};

export function FormsClient({
  initialForms,
  isOperator = false,
  seriesOptions = [],
}: {
  initialForms: FormSummary[];
  /** forms_operator view: builds and runs the forms opened to operators; no blank form, no delete. */
  isOperator?: boolean;
  /** Tours series a new series form can be made for (staff only). */
  seriesOptions?: FormSeries[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [forms, setForms] = useState(initialForms);
  const [deleting, setDeleting] = useState<FormSummary | null>(null);
  const [newSeries, setNewSeries] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      try {
        const form = await createForm();
        router.push(`/forms/${form.id}/edit`);
      } catch {
        toast({ title: "Could not create the form", variant: "destructive" });
      }
    });
  }

  function handleDuplicate(form: FormSummary) {
    startTransition(async () => {
      try {
        const copy = await duplicateForm(form.id);
        // The copy is a draft - staff and operators both finish it in the builder.
        router.push(`/forms/${copy.id}/edit`);
      } catch {
        toast({ title: "Could not duplicate the form", variant: "destructive" });
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      try {
        await softDeleteForm(target.id);
        setForms((prev) => prev.filter((f) => f.id !== target.id));
        toast({ title: "Form deleted" });
      } catch {
        toast({ title: "Could not delete the form", variant: "destructive" });
      } finally {
        setDeleting(null);
      }
    });
  }

  async function copyLink(slug: string) {
    const url = `${window.location.origin}/f/${slug}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Public link copied", description: url });
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/forms/hotels">
            <BedDouble className="mr-2 h-4 w-4" />
            Hotels report
          </Link>
        </Button>
        {seriesOptions.length > 0 && forms.length > 0 && (
          <Button variant="outline" onClick={() => setNewSeries(true)} disabled={pending}>
            <Layers className="mr-2 h-4 w-4" />
            New series form
          </Button>
        )}
        {!isOperator && (
          <Button onClick={handleCreate} disabled={pending}>
            <Plus className="mr-2 h-4 w-4" />
            New form
          </Button>
        )}
      </div>

      {newSeries && (
        <NewSeriesFormDialog
          open={newSeries}
          onOpenChange={setNewSeries}
          forms={forms}
          seriesOptions={seriesOptions}
        />
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Series</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Questions</TableHead>
              <TableHead className="text-right">Responses</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {forms.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No forms yet. Create the first one.
                </TableCell>
              </TableRow>
            )}

            {forms.map((form) => (
              <TableRow key={form.id}>
                <TableCell>
                  <Link href={`/forms/${form.id}/edit`} className="font-medium hover:underline">
                    {adminLabel(form.title_en, form.title_he) || "Untitled form"}
                  </Link>
                  {form.title_en && form.title_he && (
                    <div className="text-xs text-muted-foreground" dir="rtl">
                      {form.title_he}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">/f/{form.slug}</div>
                </TableCell>
                <TableCell>
                  {form.series ? (
                    <div>
                      <span className="font-mono text-sm font-semibold">{form.series.code}</span>
                      {form.series.name && (
                        <div className="text-xs text-muted-foreground" dir="auto">
                          {form.series.name}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">General</span>
                  )}
                  {form.audience === "escorts" && (
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      Escort feedback
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[form.status]}>{form.status}</Badge>
                </TableCell>
                <TableCell className="text-right">{form.field_count}</TableCell>
                <TableCell className="text-right">
                  {form.response_count > 0 ? (
                    <Link
                      href={`/forms/${form.id}/report`}
                      className="font-medium hover:underline"
                    >
                      {form.response_count}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(form.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Form actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => router.push(`/forms/${form.id}/edit`)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push(`/forms/${form.id}/report`)}>
                        <Map className="mr-2 h-4 w-4" /> Trips report
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push(`/forms/${form.id}/invites`)}>
                        <Send className="mr-2 h-4 w-4" /> Send / invites
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyLink(form.slug)}>
                        <Link2 className="mr-2 h-4 w-4" /> Copy public link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(form)}>
                        <Copy className="mr-2 h-4 w-4" /> Duplicate
                      </DropdownMenuItem>
                      {!isOperator && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleting(form)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{deleting ? adminLabel(deleting.title_en, deleting.title_he) : ""}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The form stops accepting answers and disappears from this list. Its{" "}
              {deleting?.response_count ?? 0} response(s) stay in the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
