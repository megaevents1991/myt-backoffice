"use client";

/**
 * The pieces around a site-content editor: its link back to the list, the
 * screen shown when its data could not be loaded, and the two notes of its
 * save cycle. The save bar itself is components/sticky-save-bar.tsx, the one
 * the Mega Events editors use.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";

/** The note of the save bar while a content editor has unsaved changes. */
export const CONTENT_UNSAVED_NOTE = "You have unsaved changes. They reach the site only after you save and publish.";

/** The toast after a content save. */
export const CONTENT_SAVED_NOTE = "Saved. Click Publish Site to show the change on the site.";

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
          {/failed/i.test(message) && <p className="text-sm text-muted-foreground">Refresh the page to try again.</p>}
          {backHref && <BackLink href={backHref}>{backLabel ?? "Back to list"}</BackLink>}
        </div>
      </div>
    </div>
  );
}
