"use client";

/**
 * The hotels of a tour (packages.hotels - the site's HotelStay list). Picked
 * from the company's hotel catalog or typed in, then given the nights and the
 * board of this tour. One copy for the tour page and for Create Tour.
 */
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyLine, Field, Section, selectClass } from "@/components/tours/ui";
import { ImageUrlField, RowControls, moved } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { hotelStayOf, type TourHotelPick, type TourHotelStay } from "@/components/tours/content/shared";

const BLANK: TourHotelStay = { name: "", location: "", stars: null, nights: "", image: "", html: "" };

export function TourHotelsEditor({
  value,
  onChange,
  catalog,
  siteUrl,
}: {
  value: TourHotelStay[];
  onChange: (hotels: TourHotelStay[]) => void;
  catalog: TourHotelPick[];
  siteUrl: string | null;
}) {
  const [pick, setPick] = useState("");
  const patch = (index: number, change: Partial<TourHotelStay>) =>
    onChange(value.map((h, i) => (i === index ? { ...h, ...change } : h)));
  const addPicked = () => {
    const hotel = catalog.find((h) => h.id === pick);
    if (!hotel) return;
    onChange([...value, hotelStayOf(hotel)]);
    setPick("");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${selectClass} min-w-56`}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Hotel from the catalog"
        >
          <option value="">{catalog.length ? "Choose a hotel from the catalog…" : "The hotel catalog is empty"}</option>
          {catalog.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.city ? ` · ${h.city}` : ""}
              {h.stars ? ` · ${h.stars}★` : ""}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" disabled={!pick} onClick={addPicked}>
          <Plus />
          Add from Catalog
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, { ...BLANK }])}>
          <Plus />
          New Hotel
        </Button>
      </div>

      {value.length === 0 && <EmptyLine>No hotels on this tour yet.</EmptyLine>}
      {value.map((hotel, index) => (
        <Section
          key={index}
          title={hotel.name || `Hotel ${index + 1}`}
          actions={
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
              removeLabel="Remove Hotel"
            />
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Name" className="md:col-span-2">
              <Input dir="auto" value={hotel.name} onChange={(e) => patch(index, { name: e.target.value })} />
            </Field>
            <Field label="City">
              <Input dir="auto" value={hotel.location} onChange={(e) => patch(index, { location: e.target.value })} />
            </Field>
            <Field label="Stars">
              <Input
                type="number"
                min={1}
                max={7}
                dir="ltr"
                value={hotel.stars ?? ""}
                onChange={(e) => patch(index, { stars: e.target.value ? Math.trunc(Number(e.target.value)) || null : null })}
              />
            </Field>
            <Field label="Nights">
              <Input dir="ltr" value={hotel.nights} onChange={(e) => patch(index, { nights: e.target.value })} />
            </Field>
            <Field label="Board" hint="e.g. ארוחת בוקר">
              <Input dir="auto" value={hotel.board ?? ""} onChange={(e) => patch(index, { board: e.target.value })} />
            </Field>
          </div>
          <ImageUrlField
            label="Image"
            value={hotel.image}
            onChange={(image) => patch(index, { image })}
            siteUrl={siteUrl}
            folder="hotels"
          />
          <HtmlField
            label="Description"
            value={hotel.html}
            onChange={(html) => patch(index, { html })}
            siteUrl={siteUrl}
            rows={5}
          />
        </Section>
      ))}
    </div>
  );
}
