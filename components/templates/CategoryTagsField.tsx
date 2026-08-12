"use client";

import { useEffect, useState } from "react";
import { listTags } from "@/lib/actions/event-taxonomy-actions";
import {
  EventTaxonomySelect,
  type TaxonomyOption,
} from "@/components/taxonomy/event-taxonomy-select";

/**
 * The category's membership rule, on the Templates form where the page is
 * built: tags compose a category, never the other way round. Every event
 * carrying ONE of these tags is pulled in automatically - events are only ever
 * tagged, never assigned to a category by hand.
 *
 * New tags can be created right here (the picker asks for the English name it
 * needs for the feed slug) and then used on events.
 */
export function CategoryTagsField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [options, setOptions] = useState<TaxonomyOption[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listTags()
      .then((tags) => setOptions(tags.map((t) => ({ id: t.id, label: t.name }))))
      .catch((e) => {
        console.error("Failed to load tags for category form:", e);
        setFailed(true);
      });
  }, []);

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">תגיות שמרכיבות את הקטגוריה</p>
        <p className="text-xs text-muted-foreground">
          כל אירוע שנושא אחת מהתגיות האלה נכנס לקטגוריה אוטומטית. אירוע יכול להיות
          בכמה קטגוריות. אפשר ליצור כאן תגית חדשה ולהשתמש בה אחר כך על אירועים.
        </p>
      </div>
      {failed ? (
        <p className="text-sm text-destructive">
          טעינת התגיות נכשלה - רענן את העמוד כדי לערוך אותן.
        </p>
      ) : (
        <EventTaxonomySelect
          options={options}
          value={value}
          onChange={onChange}
          onOptionCreated={(o) => setOptions((prev) => [...prev, o])}
        />
      )}
      {value.length === 0 && !failed && (
        <p className="text-xs text-amber-600">
          בלי תגיות הקטגוריה תישאר ריקה - לא ייכנסו אליה אירועים.
        </p>
      )}
    </div>
  );
}
