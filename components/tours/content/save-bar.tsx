"use client";

/**
 * The pieces around a site-content editor: its link back to the list, its
 * "View on Site" button, the screen shown when its data could not be loaded,
 * and the two notes of its save cycle. The save bar itself is
 * components/sticky-save-bar.tsx, the one the Mega Events editors use.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/tours/ui";

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

/** "View on Site" in an editor's header, while the page is live on the site (no address, no button). */
export function ViewOnSiteButton({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <Button asChild variant="ghost">
      <a href={href} target="_blank" rel="noreferrer">
        <ExternalLink />
        View on Site
      </a>
    </Button>
  );
}

/**
 * What a server-rendered content page shows when its data could not be
 * loaded: the shared LoadError, with a hint to refresh (a server page has no
 * retry button) and a link back to the list.
 */
export function PageLoadError({ message, backHref, backLabel }: { message: string; backHref?: string; backLabel?: string }) {
  return (
    <LoadError message={message}>
      {/* a refusal (wrong company, no permission, no such row) is not fixed by a refresh */}
      {/failed/i.test(message) && <p className="text-sm text-muted-foreground">Refresh the page to try again.</p>}
      {backHref && <BackLink href={backHref}>{backLabel ?? "Back to list"}</BackLink>}
    </LoadError>
  );
}
