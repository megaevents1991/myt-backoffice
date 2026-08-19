"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { partnerLink } from "@/lib/site";
import type { QuoteEventOption } from "@/lib/actions/quote-actions";

function CopyField({ value, label }: { value: string; label: string }) {
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

export function LinkBuilder({
  trackingCode,
  events,
  agentUtm,
}: {
  trackingCode: string;
  events: QuoteEventOption[];
  agentUtm?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<QuoteEventOption | null>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return events.slice(0, 8);
    return events
      .filter((event) => event.name.toLowerCase().includes(term))
      .slice(0, 8);
  }, [events, query]);

  return (
    <div className="space-y-6">
      <CopyField
        label="הלינק הכללי שלכם"
        value={partnerLink(trackingCode, undefined, undefined, agentUtm)}
      />

      <div className="space-y-3">
        <Label htmlFor="event-search">לינק לאירוע מסוים</Label>
        <div className="relative">
          <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="event-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="חיפוש אירוע..."
            className="pe-9"
          />
        </div>

        {!selected && (
          <ul className="divide-y rounded-md border">
            {matches.length === 0 ? (
              <li className="p-3 text-sm text-muted-foreground">לא נמצאו אירועים</li>
            ) : (
              matches.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-start hover:bg-muted"
                    onClick={() => setSelected(event)}
                  >
                    <span className="block truncate text-sm font-medium">{event.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[event.location, event.date].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        {selected && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{selected.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[selected.location, selected.date].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                שינוי
              </Button>
            </div>
            <CopyField
              label="לינק ישיר לאירוע"
              value={partnerLink(trackingCode, selected.id, undefined, agentUtm)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
