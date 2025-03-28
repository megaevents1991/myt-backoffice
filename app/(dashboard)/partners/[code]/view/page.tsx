"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Partner } from "@/types/partner.types";
import { getPartner } from "@/lib/actions/partner-actions";

export default function ViewPartnerPage({
  params,
}: {
  params: { code: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPartner() {
      try {
        const data = await getPartner(params.code);
        setPartner(data);
      } catch (error) {
        console.error("Error fetching partner:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load partner details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchPartner();
  }, [params.code, toast]);

  if (loading) {
    return <div>Loading partner details...</div>;
  }

  if (!partner) {
    return <div>Partner not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-3xl font-bold tracking-tight ml-4">
            Partner: {partner.email}
          </h1>
        </div>
        <Link href={`/partners/${partner.partner_tracking_code}`}>
          <Button>
            <Edit className="mr-2 h-4 w-4" />
            Edit Partner
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Partner Information</CardTitle>
          <CardDescription>
            Details about this affiliate partner
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">Tracking Code</p>
            <p className="text-lg font-mono">{partner.partner_tracking_code}</p>
          </div>

          <div>
            <p className="text-sm font-medium">Email</p>
            <p className="text-lg">{partner.email}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium">Commission</p>
              <p className="text-lg">${partner.commission.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm font-medium">User Discount</p>
              <p className="text-lg">${partner.user_discount.toFixed(2)}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Created At</p>
            <p className="text-lg">
              {new Date(partner.created_at).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
