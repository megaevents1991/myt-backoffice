"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useActionToast } from "@/hooks/use-action-toast";
import { CONTENT_SAVED_NOTE } from "@/components/tours/content/save-bar";
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
  const run = useActionToast();
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
    const result = await run(() => save(form), CONTENT_SAVED_NOTE);
    setIsSaving(false);
    if (!result.success) return;
    setSaved(result.data);
    setForm(result.data.form);
    router.refresh();
  }, [form, isSaving, router, run, save]);

  const discard = useCallback(() => setForm(saved.form), [saved.form]);

  return { saved, form, set, isDirty, isSaving, submit, discard };
}
