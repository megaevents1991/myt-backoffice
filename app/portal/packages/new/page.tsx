import { getSession } from "@/lib/auth/guards";
import { getPackageBuilderEvents } from "@/lib/actions/portal-package-actions";
import { PackageWizard } from "./package-wizard";

export const dynamic = "force-dynamic";

export default async function NewPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const session = await getSession();
  if (!session?.partner_code) return null;

  const { event: eventParam } = await searchParams;
  const initialEventId = Number(eventParam);
  const events = await getPackageBuilderEvents();

  return (
    <main className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">בניית חבילה</h1>
        <p className="text-sm text-muted-foreground">
          בוחרים אירוע, כרטיסים, טיסה ומלון — ומקבלים לינק שמנחית את הלקוח ישר
          על החבילה המוכנה.
        </p>
      </div>
      <PackageWizard
        events={events}
        initialEventId={Number.isFinite(initialEventId) ? initialEventId : undefined}
      />
    </main>
  );
}
