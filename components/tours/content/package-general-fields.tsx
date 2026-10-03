"use client";

/**
 * The details of a tour: name, address, type, card colour, length, countries,
 * seasons. One copy for the tour page (General tab) and for Create Tour.
 */
import { useState, type ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, Section } from "@/components/tours/ui";
import { StringListEditor } from "@/components/tours/content/fields";
import { useActionToast } from "@/hooks/use-action-toast";
import { createTourTerm } from "@/lib/actions/tours-catalog-actions";
import {
  PACKAGE_BRANDS,
  PACKAGE_BRAND_COLORS,
  PACKAGE_BRAND_LABELS,
  PACKAGE_KINDS,
  PACKAGE_KIND_LABELS,
  PACKAGE_TERM_KINDS,
  TERM_KIND_LABELS,
  type PackageForm,
  type PackageKind,
  type TermOption,
} from "@/components/tours/content/shared";

const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function PackageGeneralFields({
  form,
  set,
  slugHint,
  slugLocked = false,
  kinds = PACKAGE_KINDS,
  extra,
}: {
  form: PackageForm;
  set: <K extends keyof PackageForm>(key: K, value: PackageForm[K]) => void;
  slugHint: ReactNode;
  slugLocked?: boolean;
  /** The types offered (Create Tour offers only the ones a new tour can be). */
  kinds?: readonly PackageKind[];
  /** Anything that belongs next to the fields, e.g. the "Active on site" switch of the tour page. */
  extra?: ReactNode;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tour name">
          <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Subtitle">
          <Input dir="auto" value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
        </Field>
        <Field label="Slug" hint={slugHint} className="md:col-span-2">
          <Input dir="auto" value={form.slug} disabled={slugLocked} onChange={(e) => set("slug", e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="pkg-kind">
          <Select value={form.kind} onValueChange={(value) => set("kind", value)} disabled={kinds.length < 2}>
            <SelectTrigger id="pkg-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {PACKAGE_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Card color on site" htmlFor="pkg-brand">
          <Select value={form.brand} onValueChange={(value) => set("brand", value)}>
            <SelectTrigger id="pkg-brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PACKAGE_BRANDS.map((brand) => (
                <SelectItem key={brand} value={brand}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: PACKAGE_BRAND_COLORS[brand] }}
                    />
                    {PACKAGE_BRAND_LABELS[brand]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Days">
          <Input
            type="number"
            min={0}
            dir="ltr"
            value={form.days ?? ""}
            onChange={(e) => set("days", numberOrNull(e.target.value))}
          />
        </Field>
        <Field label="Nights">
          <Input
            type="number"
            min={0}
            dir="ltr"
            value={form.nights ?? ""}
            onChange={(e) => set("nights", numberOrNull(e.target.value))}
          />
        </Field>
        <Field label="Countries" hint='As shown on the site, e.g. "מדינה אחת" or "3 מדינות"'>
          <Input dir="auto" value={form.countries} onChange={(e) => set("countries", e.target.value)} />
        </Field>
        {extra}
      </div>
      <StringListEditor
        label="Seasons"
        value={form.seasons}
        onChange={(value) => set("seasons", value)}
        placeholder="קיץ, חנוכה, פסח..."
        addLabel="Add Season"
        hint="The first season also labels the dates and the badge at the top of the page."
      />
    </>
  );
}

/** The kinds a new tour usually needs - shown even before the company has a term of that kind. */
const MAIN_TERM_KINDS: string[] = ["destinations", "audiences", "tags", "categories"];

/** "+ New ..." of one kind: creates the term at once and ticks it. */
function NewTermField({ kind, onCreated }: { kind: string; onCreated: (term: TermOption) => void }) {
  const run = useActionToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const label = TERM_KIND_LABELS[kind as keyof typeof TERM_KIND_LABELS] ?? kind;
  const create = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    const res = await run(() => createTourTerm({ kind, name: value }), (a) => `${a.data.name} added`);
    setBusy(false);
    if (!res.success) return;
    onCreated(res.data);
    setName("");
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        dir="auto"
        className="h-8 w-48"
        placeholder={`New in ${label}`}
        aria-label={`New in ${label}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void create();
          }
        }}
      />
      <Button type="button" variant="ghost" size="sm" disabled={!name.trim() || busy} onClick={() => void create()}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        Add
      </Button>
    </div>
  );
}

/**
 * The categories and tags of a tour: one card per kind, ticked terms attach
 * it. With `onTermCreated`, each card can create a new term on the spot.
 */
export function PackageTermsPicker({
  terms,
  value,
  onChange,
  onTermCreated,
}: {
  terms: TermOption[];
  value: string[];
  onChange: (termIds: string[]) => void;
  /** A term was created here: the parent adds it to its list. */
  onTermCreated?: (term: TermOption) => void;
}) {
  const selected = new Set(value);
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((t) => t !== id));
  return (
    <>
      {PACKAGE_TERM_KINDS.map((kind) => {
        const options = terms.filter((term) => term.kind === kind);
        if (options.length === 0 && !(onTermCreated && MAIN_TERM_KINDS.includes(kind))) return null;
        const chosen = options.filter((term) => selected.has(term.id)).length;
        return (
          <Section
            key={kind}
            title={`${TERM_KIND_LABELS[kind]} (${chosen})`}
            actions={
              onTermCreated && (
                <NewTermField
                  kind={kind}
                  onCreated={(term) => {
                    if (!terms.some((t) => t.id === term.id)) onTermCreated(term);
                    if (!selected.has(term.id)) onChange([...value, term.id]);
                  }}
                />
              )
            }
          >
            {options.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet - add the first one.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {options.map((term) => (
                  <label key={term.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={selected.has(term.id)} onCheckedChange={(on) => toggle(term.id, on === true)} />
                    <span>{term.name}</span>
                    {!term.isActive && <span className="text-xs text-muted-foreground">(Inactive)</span>}
                  </label>
                ))}
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}
