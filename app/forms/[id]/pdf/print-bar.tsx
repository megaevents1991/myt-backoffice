"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The only on-screen chrome of the PDF page (hidden when printing). It names
 * the tab after the export - Chrome and Edge offer the tab title as the PDF's
 * file name - and opens the print dialog once the page (fonts, logo) is ready,
 * so "Export PDF" is one click plus "Save as PDF".
 */
export function PrintBar({
  fileName,
  label,
  hint,
  dir,
}: {
  fileName: string;
  label: string;
  hint: string;
  dir: "rtl" | "ltr";
}) {
  useEffect(() => {
    document.title = fileName;
    let cancelled = false;
    const loaded =
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) =>
            window.addEventListener("load", () => resolve(), { once: true }),
          );
    Promise.all([loaded, document.fonts?.ready])
      .then(() => {
        if (!cancelled) window.setTimeout(() => window.print(), 300);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  return (
    <div
      dir={dir}
      className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-3 text-zinc-900 backdrop-blur print:hidden"
    >
      <p className="text-sm text-zinc-600">{hint}</p>
      <Button type="button" size="sm" onClick={() => window.print()}>
        <Printer className="me-1.5 h-4 w-4" />
        {label}
      </Button>
    </div>
  );
}
