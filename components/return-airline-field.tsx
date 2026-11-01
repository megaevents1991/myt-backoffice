"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cleanAirlineCode } from "@/lib/airline-lookup";
import { flownBackByAnother, type ReturnAirline } from "@/lib/flight-return-airline";

/**
 * "Flown back by another airline" on the three flight forms of a tours company
 * (new, series, edit). The same lookup as the outbound airline's: code in, name
 * and logo out - and the name stays typeable, so a lookup that is down or has no
 * record never stops a flight from being saved.
 */
export function ReturnAirlineField({
  value,
  onChange,
  outboundCode,
  error,
}: {
  value: ReturnAirline;
  onChange: (next: ReturnAirline) => void;
  outboundCode: string;
  error?: string | null;
}) {
  const [isLooking, setIsLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const code = cleanAirlineCode(value.code);
  const another = flownBackByAnother(code, outboundCode);

  const lookUp = async () => {
    setIsLooking(true);
    setLookupError(null);
    try {
      const response = await fetch("/api/validate-airline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airlineCode: code }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        onChange({ code: data.iataCode ?? code, name: data.airlineName, logo: data.airlineLogo ?? "" });
      } else {
        setLookupError(`${data.error || "Could not find that airline code"} - you can type the name instead.`);
      }
    } catch (lookupFailure) {
      console.error("Return airline lookup failed:", lookupFailure);
      setLookupError("Could not reach the airline lookup - you can type the name instead.");
    } finally {
      setIsLooking(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-return-airline>
      <div>
        <Label htmlFor="return-airline-code">Return airline code (optional)</Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="return-airline-code"
            value={value.code}
            placeholder="LX"
            onChange={(e) => {
              setLookupError(null);
              // The name and logo belong to the code they were looked up for.
              onChange({ code: e.target.value.toUpperCase(), name: "", logo: "" });
            }}
          />
          <Button type="button" variant="outline" disabled={isLooking || !another} onClick={lookUp}>
            {isLooking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {code && !another
            ? "Same as the outbound airline - nothing to add."
            : "Only when another airline flies back. The Airline Code above stays the outbound airline."}
        </p>
      </div>
      <div>
        <Label htmlFor="return-airline-name">Return airline name</Label>
        <div className="mt-2 flex items-center gap-2">
          <Input
            id="return-airline-name"
            value={value.name}
            disabled={!another}
            placeholder={another ? "Swiss" : ""}
            onChange={(e) => {
              setLookupError(null);
              onChange({ ...value, name: e.target.value });
            }}
          />
          {another && value.logo && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={value.logo} alt={value.name} className="h-9 w-auto object-contain" />
          )}
        </div>
      </div>
      {(lookupError || error) && (
        <p className="text-sm text-destructive md:col-span-2">{lookupError || error}</p>
      )}
    </div>
  );
}
