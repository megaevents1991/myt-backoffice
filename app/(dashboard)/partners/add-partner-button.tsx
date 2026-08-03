"use client";

import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ADMIN_ROLES } from "@/types/auth.types";
import { useAuth } from "@/contexts/auth-context";

/** Adding a partner also creates its portal login — an admin-only action. */
export function AddPartnerButton() {
  const { user: me } = useAuth();
  if (!me || !ADMIN_ROLES.includes(me.role)) return null;
  return (
    <Link href="/partners/new">
      <Button>
        <PlusCircle className="mr-2 h-4 w-4" />
        Add Partner
      </Button>
    </Link>
  );
}
