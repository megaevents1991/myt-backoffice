import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth/guards";
import { getMyPreparedPackages } from "@/lib/actions/portal-package-actions";
import { Button } from "@/components/ui/button";
import { PackagesList } from "./packages-list";

export const dynamic = "force-dynamic";

export default async function PortalPackagesPage() {
  const session = await getSession();
  if (!session?.partner_code) return null;

  const packages = await getMyPreparedPackages();

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">החבילות שלי</h1>
          <p className="text-sm text-muted-foreground">
            חבילה מוכנה = לינק שמנחית את הלקוח ישר על הרכב שבחרתם — כרטיס, טיסה
            ומלון — בלי לחפש לבד.
          </p>
        </div>
        <Button
          asChild
          className="rounded-full bg-brand-mint px-5 font-semibold text-brand-forest transition-all duration-200 hover:bg-brand-mint/90 hover:shadow-mint-glow active:scale-[0.98]"
        >
          <Link href="/portal/packages/new">
            <Plus className="h-4 w-4" />
            בניית חבילה חדשה
          </Link>
        </Button>
      </div>

      <PackagesList packages={packages} />
    </main>
  );
}
