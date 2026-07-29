import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicFormBySlug } from "@/lib/actions/form-response-actions";
import { pickLang, strings } from "@/lib/forms/i18n";
import type { FormLang } from "@/types/form.types";
import { FormRenderer } from "../form-renderer";
import { FormMessage } from "../form-message";

// Public, unauthenticated and always current — never cache a form page.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await getPublicFormBySlug(slug);
  if (loaded.state !== "ok") return { title: "Form" };
  return {
    title: pickLang(loaded.payload.form.title_en, loaded.payload.form.title_he, loaded.lang),
    robots: { index: false, follow: false },
  };
}

export default async function PublicFormPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { lang: langParam } = await searchParams;

  const loaded = await getPublicFormBySlug(slug);
  if (loaded.state === "not_found") notFound();

  if (loaded.state === "closed") {
    const lang: FormLang = langParam === "he" ? "he" : "en";
    return <FormMessage lang={lang} message={strings(lang).closed} />;
  }
  if (loaded.state === "already_submitted") {
    return <FormMessage lang={loaded.lang} message={strings(loaded.lang).alreadySubmitted} />;
  }

  const lang: FormLang =
    langParam === "he" ? "he" : langParam === "en" ? "en" : loaded.lang;

  return <FormRenderer payload={loaded.payload} initialLang={lang} slug={slug} />;
}
