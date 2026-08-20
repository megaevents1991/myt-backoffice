import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicFormByToken } from "@/lib/actions/form-response-actions";
import { pickLang, strings } from "@/lib/forms/i18n";
import { resolveLang } from "@/types/form.types";
import type { FormLang } from "@/types/form.types";
import { FormRenderer } from "../../form-renderer";
import { FormMessage } from "../../form-message";

// Personal link - never cached, never indexed.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const loaded = await getPublicFormByToken(token);
  if (loaded.state !== "ok") return { title: "Form", robots: { index: false, follow: false } };
  return {
    title: pickLang(loaded.payload.form.title_en, loaded.payload.form.title_he, loaded.lang),
    robots: { index: false, follow: false },
  };
}

export default async function InviteFormPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { lang: langParam } = await searchParams;

  const loaded = await getPublicFormByToken(token);
  if (loaded.state === "not_found") notFound();

  if (loaded.state === "closed") {
    const lang: FormLang = langParam === "he" ? "he" : "en";
    return <FormMessage lang={lang} message={strings(lang).closed} />;
  }
  if (loaded.state === "already_submitted") {
    return <FormMessage lang={loaded.lang} message={strings(loaded.lang).alreadySubmitted} />;
  }

  const requested: FormLang | null =
    langParam === "he" ? "he" : langParam === "en" ? "en" : null;
  const lang = resolveLang(loaded.payload.form.languages, requested, loaded.lang);

  return (
    <FormRenderer
      payload={loaded.payload}
      initialLang={lang}
      prefill={loaded.prefill}
      staffSummary={loaded.staffSummary}
      tripCode={loaded.tripCode}
      token={token}
    />
  );
}
