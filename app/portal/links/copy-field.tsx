"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins and in some browsers - the
      // input stays selectable, so copying by hand still works.
      setCopied(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly dir="ltr" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" onClick={handleCopy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="ms-2">{copied ? "הועתק" : "העתקה"}</span>
        </Button>
      </div>
    </div>
  );
}
