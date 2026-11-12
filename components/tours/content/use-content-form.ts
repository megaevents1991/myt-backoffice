"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  // a second click before the first save re-rendered must not send the same save again (it would be refused
  // as "someone else saved" - by the first click)
  const savingRef = useRef(false);
  // what is on screen right now, for a merge that lands after an await (the person may have typed meanwhile)
  const savedRef = useRef(saved);
  const formRef = useRef(form);
  savedRef.current = saved;
  formRef.current = form;

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved.form), [form, saved.form]);

  const set = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      const result = await run(() => save(form), CONTENT_SAVED_NOTE);
      if (!result.success) return;
      setSaved(result.data);
      setForm(result.data.form);
      router.refresh();
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [form, router, run, save]);

  const discard = useCallback(() => setForm(saved.form), [saved.form]);

  /** The saved copy and the form as they are this moment (after an await, not as the closure saw them). */
  const current = useCallback(() => ({ saved: savedRef.current, form: formRef.current }), []);

  /**
   * Takes a newer saved copy as the baseline and puts `nextForm` on screen, in one step - so the next save
   * names the version the form was built on (an editor that merges another person's save into its own).
   */
  const rebase = useCallback((nextSaved: D, nextForm: F) => {
    savedRef.current = nextSaved;
    formRef.current = nextForm;
    setSaved(nextSaved);
    setForm(nextForm);
  }, []);

  return { saved, form, set, isDirty, isSaving, submit, discard, current, rebase };
}
