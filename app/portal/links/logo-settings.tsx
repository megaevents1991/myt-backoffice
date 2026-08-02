"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  uploadPartnerLogo,
  removePartnerLogo,
} from "@/lib/actions/portal-branding-actions";

export function LogoSettings({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleUpload = async (file: File) => {
    setBusy(true);
    try {
      const data = new FormData();
      data.set("file", file);
      const result = await uploadPartnerLogo(data);
      if (!result.ok) {
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
        return;
      }
      toast({ title: "הלוגו נשמר" });
      router.refresh();
    } catch (error) {
      // A thrown action (session expired, body too large, network) would
      // otherwise be an unhandled rejection and nothing on screen would change.
      console.error("uploadPartnerLogo:", error);
      toast({
        variant: "destructive",
        title: "שגיאה",
        description: "העלאת הלוגו נכשלה. נסו שוב.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      const result = await removePartnerLogo();
      if (!result.ok) {
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
        return;
      }
      toast({ title: "הלוגו הוסר" });
      router.refresh();
    } catch (error) {
      console.error("removePartnerLogo:", error);
      toast({
        variant: "destructive",
        title: "שגיאה",
        description: "לא הצלחנו להסיר את הלוגו",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {logoUrl && (
        <div className="flex items-center gap-3">
          {/* Plain img: the bucket is public but the host isn't in next.config
              images.remotePatterns, and next/image would refuse it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt="הלוגו שלכם"
            className="h-12 w-auto rounded border bg-white object-contain p-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={handleRemove}
            disabled={busy}
            aria-label="הסרת הלוגו"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="partner-logo">
          {logoUrl ? "החלפת הלוגו" : "העלאת לוגו"}
        </Label>
        <Input
          id="partner-logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            // Clear so re-picking the same file after a failure still fires.
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">
          PNG, JPG או WebP, עד 2MB. מופיע בהצעות המחיר שלכם ובראש הפורטל.
        </p>
      </div>
    </div>
  );
}
