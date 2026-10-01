"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Inbox, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { cn } from "@/lib/utils";

/**
 * The Hebrew twin of components/sticky-save-bar.tsx (same place, same motion):
 * slides up from the bottom once the form is dirty, with save and discard.
 */
export function ContentSaveBar({
  isDirty,
  isSaving,
  onSave,
  onDiscard,
  disabledReason,
}: {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Set while the form cannot be saved - shown instead of the plain "unsaved" note. */
  disabledReason?: string | null;
}) {
  const visible = isDirty || isSaving;
  return (
    <>
      <UnsavedChangesGuard when={isDirty && !isSaving} />
      <div
        role="region"
        aria-label="Unsaved changes"
        aria-hidden={!visible}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 md:left-64",
          "surface-chrome border-t shadow-[0_-2px_10px_rgba(0,0,0,0.06)]",
          "transition-transform duration-200 ease-in-out",
          // `invisible` when idle: the hidden bar must not be focusable, nor show up in a full-page capture
          visible ? "translate-y-0" : "pointer-events-none invisible translate-y-full",
        )}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <span className={cn("text-sm text-muted-foreground", disabledReason && "text-destructive")}>
            {disabledReason || "You have unsaved changes. They reach the site only after you save and publish."}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onDiscard} disabled={isSaving} tabIndex={visible ? 0 : -1}>
              Discard
            </Button>
            <Button type="button" onClick={onSave} disabled={isSaving || !!disabledReason} tabIndex={visible ? 0 : -1}>
              {isSaving && <Loader2 className="animate-spin" />}
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** "Back to the list" link above an editor. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      {children}
    </Link>
  );
}

/** What a screen shows when its data could not be loaded. */
export function LoadError({ message, backHref, backLabel }: { message: string; backHref?: string; backLabel?: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-2">
          <p className="font-medium">{message}</p>
          {/* a refusal (wrong company, no permission, no such row) is not fixed by a refresh */}
          {/נכשל|failed/i.test(message) && <p className="text-sm text-muted-foreground">Refresh the page to try again.</p>}
          {backHref && <BackLink href={backHref}>{backLabel ?? "Back to list"}</BackLink>}
        </div>
      </div>
    </div>
  );
}

/** An empty list: says what would be here and, when a filter hides rows, how to see them. */
export function EmptyRows({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground/60" />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-[50ch] text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
