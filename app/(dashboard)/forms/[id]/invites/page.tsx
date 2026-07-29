import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getForm } from "@/lib/actions/form-actions";
import { getFormInvites } from "@/lib/actions/form-invite-actions";
import { adminLabel } from "@/lib/forms/i18n";
import { InvitesClient } from "./invites-client";

export const dynamic = "force-dynamic";

export default async function FormInvitesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const formId = Number(id);
  if (!Number.isFinite(formId)) notFound();

  const loaded = await getForm(formId);
  if (!loaded) notFound();

  const invites = await getFormInvites(formId);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
          <Link href={`/forms/${formId}/edit`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to the form
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          Send “{adminLabel(loaded.form.title_en, loaded.form.title_he)}”
        </h1>
        <p className="text-muted-foreground">
          Each recipient gets their own link, so you can see who opened it and who
          filled it in. The shared public link stays available too.
        </p>
      </div>

      <InvitesClient
        formId={formId}
        formStatus={loaded.form.status}
        defaultLang={loaded.form.default_lang}
        initialInvites={invites}
      />
    </div>
  );
}
