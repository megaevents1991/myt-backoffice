"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { cn } from "@/lib/utils";

type StickySaveBarProps = {
  /** Controls slide-up visibility. */
  isDirty: boolean;
  /** Shows spinner and disables both buttons. */
  isSaving: boolean;
  /** Primary action - should call the same submit handler as the bottom button. */
  onSave: () => void;
  /** Resets the form back to its original (loaded) values. */
  onDiscard: () => void;
  saveLabel?: string;
  savingLabel?: string;
  /** e.g. a validation gate that isn't satisfied yet. */
  disabled?: boolean;
  /** Tooltip shown on the Save button while `disabled`. */
  disabledReason?: string;
};

/**
 * Fixed bottom bar that slides up once a form is dirty, giving the user a
 * Save + Discard control without scrolling to the end of long forms.
 * Prop-driven - it holds no form state of its own.
 */
export function StickySaveBar({
  isDirty,
  isSaving,
  onSave,
  onDiscard,
  saveLabel = "Save",
  savingLabel = "Saving...",
  disabled = false,
  disabledReason,
}: StickySaveBarProps) {
  const visible = isDirty || isSaving;

  const saveButton = (
    <Button type="button" onClick={onSave} disabled={disabled || isSaving}>
      {isSaving ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {savingLabel}
        </>
      ) : (
        saveLabel
      )}
    </Button>
  );

  return (
    <>
      <UnsavedChangesGuard when={isDirty && !isSaving} />
      <div
        role="region"
        aria-label="Unsaved changes"
        aria-hidden={!visible}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 md:left-64",
        "border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "shadow-[0_-2px_10px_rgba(0,0,0,0.06)]",
        "transition-transform duration-200 ease-in-out",
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      )}
    >
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <span className="text-sm text-muted-foreground">
          You have unsaved changes
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onDiscard}
            disabled={isSaving}
          >
            Discard
          </Button>
          {disabled && disabledReason ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span wrapper so the tooltip works on a disabled button */}
                  <span tabIndex={0}>{saveButton}</span>
                </TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            saveButton
          )}
        </div>
      </div>
      </div>
    </>
  );
}
