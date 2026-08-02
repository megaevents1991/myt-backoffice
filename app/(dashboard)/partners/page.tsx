"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { ADMIN_ROLES } from "@/types/auth.types";
import { useAuth } from "@/contexts/auth-context";
import { PartnersTable } from "./partners-table";

export default function PartnersPage() {
  // Adding a partner also creates its portal login — an admin-only action.
  const { user: me } = useAuth();
  const canManage = !!me && ADMIN_ROLES.includes(me.role);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Partners</h1>
          <p className="text-muted-foreground">
            Agents and influencers, their commission terms and portal access.
          </p>
        </div>
        {canManage && (
          <Link href="/partners/new">
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Partner
            </Button>
          </Link>
        )}
      </div>

      <PartnersTable />
    </div>
  );
}
