"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PromptDialog } from "@/components/prompt-dialog";

export type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
};

export type PromptOptions = {
  title?: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;
/** Resolves to the entered string, or `null` when cancelled. */
type PromptFn = (options?: PromptOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);
const PromptContext = createContext<PromptFn | null>(null);

/**
 * Mounts the app-wide ConfirmDialog / PromptDialog and exposes them as
 * awaitable functions, so call sites keep the imperative shape of the native
 * `window.confirm` / `window.prompt` they replace:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ description: "Delete this?", destructive: true }))) return;
 *
 *   const prompt = usePrompt();
 *   const url = await prompt({ title: "Link URL", defaultValue: "https://" });
 *   if (url === null) return; // cancelled
 *
 * The native browser popups are never used - these are the branded replacements.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions>({});
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptOptions, setPromptOptions] = useState<PromptOptions>({});
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts = {}) => {
    setConfirmOptions(opts);
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      // A second confirm() before the first settles would strand the old
      // promise - resolve it as cancelled rather than leaking it.
      confirmResolveRef.current?.(false);
      confirmResolveRef.current = resolve;
    });
  }, []);

  // Radix runs the action's onClick BEFORE closing, so handleConfirm always
  // wins the race and clears the ref; this then only fires for cancel, Esc
  // and outside-click.
  const handleConfirmOpenChange = useCallback((next: boolean) => {
    setConfirmOpen(next);
    if (!next) {
      confirmResolveRef.current?.(false);
      confirmResolveRef.current = null;
    }
  }, []);

  const handleConfirm = useCallback(() => {
    confirmResolveRef.current?.(true);
    confirmResolveRef.current = null;
  }, []);

  const prompt = useCallback<PromptFn>((opts = {}) => {
    setPromptOptions(opts);
    setPromptOpen(true);
    return new Promise<string | null>((resolve) => {
      promptResolveRef.current?.(null);
      promptResolveRef.current = resolve;
    });
  }, []);

  // PromptDialog submits before closing, so the ref is already cleared by then
  // and this only settles cancel / Esc / outside-click as `null`.
  const handlePromptOpenChange = useCallback((next: boolean) => {
    setPromptOpen(next);
    if (!next) {
      promptResolveRef.current?.(null);
      promptResolveRef.current = null;
    }
  }, []);

  const handlePromptSubmit = useCallback((value: string) => {
    promptResolveRef.current?.(value);
    promptResolveRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      <PromptContext.Provider value={prompt}>
        {children}
        <ConfirmDialog
          {...confirmOptions}
          open={confirmOpen}
          onOpenChange={handleConfirmOpenChange}
          onConfirm={handleConfirm}
        />
        <PromptDialog
          {...promptOptions}
          open={promptOpen}
          onOpenChange={handlePromptOpenChange}
          onSubmit={handlePromptSubmit}
        />
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return confirm;
}

export function usePrompt(): PromptFn {
  const prompt = useContext(PromptContext);
  if (!prompt) {
    throw new Error("usePrompt must be used inside <ConfirmProvider>");
  }
  return prompt;
}
