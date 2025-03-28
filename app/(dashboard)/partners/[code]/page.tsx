"use client";

import type React from "react";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { Partner } from "@/types/partner.types";
import {
  getPartner,
  updatePartner,
  createPartner,
} from "@/lib/actions/partner-actions";

export default function PartnerPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const unwrappedParams = use(params);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isNewPartner = unwrappedParams.code === "new";

  useEffect(() => {
    async function fetchPartner() {
      if (isNewPartner) {
        setPartner({
          created_at: new Date().toISOString(),
          partner_tracking_code: "",
          email: "",
          password: "",
          commission: 10,
          user_discount: 5,
        });
        setLoading(false);
        return;
      }

      try {
        const data = await getPartner(unwrappedParams.code);
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
  }, [unwrappedParams.code, toast, isNewPartner]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPartner((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [name]: value,
      };
    });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPartner((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [name]: Number.parseFloat(value),
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner) return;

    const confirmed = window.confirm(
      "Are you sure you want to save changes to this partner?"
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      if (isNewPartner) {
        await createPartner(partner);
      } else {
        await updatePartner(unwrappedParams.code, partner);
      }

      toast({
        title: "Success",
        description: "Partner has been saved successfully.",
      });
      router.push("/partners");
    } catch (error) {
      console.error("Error saving partner:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save partner. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading partner details...</div>;
  }

  if (!partner) {
    return <div>Partner not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-3xl font-bold tracking-tight ml-4">
          {isNewPartner ? "Create Partner" : `Edit Partner: ${partner.email}`}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Partner Information</CardTitle>
            <CardDescription>
              Enter the details for this affiliate partner.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isNewPartner && (
              <div className="space-y-2">
                <Label htmlFor="partner_tracking_code">Tracking Code</Label>
                <Input
                  id="partner_tracking_code"
                  name="partner_tracking_code"
                  value={partner.partner_tracking_code}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={partner.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={partner.password}
                onChange={handleChange}
                required
              />
              <p className="text-sm text-muted-foreground">
                {isNewPartner
                  ? "Set a password for the partner."
                  : "Leave unchanged to keep the current password."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="commission">Commission ($)</Label>
                <Input
                  id="commission"
                  name="commission"
                  type="number"
                  min="0"
                  value={partner.commission}
                  onChange={handleNumberChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user_discount">User Discount ($)</Label>
                <Input
                  id="user_discount"
                  name="user_discount"
                  type="number"
                  min="0"
                  value={partner.user_discount}
                  onChange={handleNumberChange}
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Partner"}
          </Button>
        </div>
      </form>
    </div>
  );
}
