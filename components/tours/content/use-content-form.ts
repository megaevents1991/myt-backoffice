"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";

import type { ActionResult } from "@/components/tours/content/shared";

/**
 * The state every simple content editor shares (taxonomy term, instructor,
 * hotel, content page): the form as typed, the form as saved, dirty tracking,
 * save and discard. The server answers a save with the row as it now is, which
 * becomes the new baseline.
 */
export function useContentForm<F extends object, D extends { form: F }>(
  initial: D,
  save: (form: F) => Promise<ActionResult<D>>,
) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<F>(initial.form);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.form), [form, saved.form]);

  const set = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await save(form);
      if (!result.success) {
        toast.error(result.error, { duration: 7000 });
        return;
      }
      setSaved(result.data);
      setForm(result.data.form);
      toast.success("Saved. Click Publish Site to show the change on the site.");
      router.refresh();
    } catch {
      toast.error("Save failed. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }, [form, isSaving, router, save]);

  const discard = useCallback(() => setForm(saved.form), [saved.form]);

  return { saved, form, set, isDirty, isSaving, submit, discard };
}
