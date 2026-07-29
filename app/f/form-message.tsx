import { dirFor, isRtl } from "@/lib/forms/i18n";
import type { FormLang } from "@/types/form.types";
import { cn } from "@/lib/utils";

/** Full-page notice for a closed or already-submitted form. */
export function FormMessage({ lang, message }: { lang: FormLang; message: string }) {
  return (
    <div
      dir={dirFor(lang)}
      className={cn("mx-auto max-w-2xl px-4 py-24", isRtl(lang) && "text-right")}
    >
      <div className="rounded-xl border bg-card p-10 text-center">
        <p className="text-lg text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
