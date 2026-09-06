import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /**
   * What this screen holds and where the data comes from - the first thing a
   * new operator reads. Say what the rows ARE, not "manage your X".
   */
  description?: ReactNode;
  /** Buttons for the top-right (primary action last). */
  actions?: ReactNode;
  /** Small label above the title - status, provider, last-synced. */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * The standard page heading. Every dashboard page hand-rolled its own <h1> +
 * muted <p> before, which is why titles drifted in size and half the screens
 * had no description at all.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
