"use client";

/**
 * The details of a tour: name, address, type, card colour, length, countries,
 * seasons. One copy for the tour page (General tab) and for Create Tour.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, Section } from "@/components/tours/ui";
import { StringListEditor } from "@/components/tours/content/fields";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { addTagsToWorld, createTourTerm } from "@/lib/actions/tours-catalog-actions";
import {
  PACKAGE_KINDS,
  PACKAGE_KIND_LABELS,
  PACKAGE_TERM_KINDS,
  TERM_KIND_LABELS,
  worldOptions,
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
  showSeasons = true,
  terms = [],
}: {
  /** The company's terms: the worlds among them are what the World list offers. */
  terms?: TermOption[];
  /** The plain list of season names - Create Tour only; a tour page edits its seasons on the Seasons tab. */
  showSeasons?: boolean;
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
        <Field label="World (card color on site)" htmlFor="pkg-brand">
          <Select value={form.brand} onValueChange={(value) => set("brand", value)}>
            <SelectTrigger id="pkg-brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* the built-in worlds, then the ones added in Categories & Tags > Worlds */}
              {worldOptions(terms).map((world) => (
                <SelectItem key={world.key} value={world.key}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: world.color || "#60356C" }}
                    />
                    {world.label}
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
      {showSeasons && (
        <StringListEditor
          label="Seasons"
          value={form.seasons}
          onChange={(value) => set("seasons", value)}
          placeholder="קיץ, חנוכה, פסח..."
          addLabel="Add Season"
          hint="The first season also labels the dates and the badge at the top of the page. Each one opens as a season of the tour (Seasons tab), where its dates and content are set."
        />
      )}
    </>
  );
}

/** The kinds a new tour usually needs - shown even before the company has a term of that kind. */
const MAIN_TERM_KINDS: string[] = ["destinations", "audiences", "tags", "categories"];

/**
 * "+ New ..." of one kind: creates the term at once and ticks it. With
 * `worlds` (the tour's worlds), a new tag is born inside one of them.
 */
function NewTermField({
  kind,
  onCreated,
  worlds = [],
}: {
  kind: string;
  onCreated: (term: TermOption) => void;
  worlds?: TermOption[];
}) {
  const run = useActionToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [worldPick, setWorldPick] = useState<string | null>(null);
  // the chosen world, while it is still one of the tour's; else the first
  const worldSlug = worlds.some((w) => w.slug === worldPick) ? (worldPick ?? "") : worldPick === "" ? "" : (worlds[0]?.slug ?? "");
  const world = worlds.find((w) => w.slug === worldSlug);
  const kindLabel = TERM_KIND_LABELS[kind as keyof typeof TERM_KIND_LABELS] ?? kind;
  const label = world ? `New tag in ${world.name}` : `New in ${kindLabel}`;
  const create = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    const res = await run(
      () => createTourTerm({ kind, name: value, ...(worldSlug ? { worldSlug } : {}) }),
      (a) => `${a.data.name} added${world && a.data.worldSlug === worldSlug ? ` to ${world.name}` : ""}`,
    );
    setBusy(false);
    if (!res.success) return;
    onCreated(res.data);
    setName("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {worlds.length > 1 && (
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="The world of the new tag"
          value={worldSlug}
          onChange={(e) => setWorldPick(e.target.value)}
        >
          {worlds.map((w) => (
            <option key={w.id} value={w.slug}>
              {w.name}
            </option>
          ))}
          <option value="">No world</option>
        </select>
      )}
      <Input
        dir="auto"
        className="h-8 w-48"
        placeholder={label}
        aria-label={label}
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
 *
 * Once the tour has a world - ticked under Worlds, or chosen as its World on
 * the Details tab - Tags shows the tags of that world only (Alon, 07.10.2026).
 * The rest wait under "other tags", one tick away, and a new tag is added to
 * the world.
 */
export function PackageTermsPicker({
  terms,
  value,
  onChange,
  onTermCreated,
  brand,
}: {
  terms: TermOption[];
  value: string[];
  onChange: (termIds: string[]) => void;
  /** A term was created here, or a tag joined a world: the parent adds it to its list, or replaces the one with its id. */
  onTermCreated?: (term: TermOption) => void;
  /** The tour's World (the key of an audience) - counts as one of its worlds. */
  brand?: string;
}) {
  const run = useActionToast();
  const confirm = useConfirm();
  const selected = new Set(value);
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((t) => t !== id));
  const [showOtherTags, setShowOtherTags] = useState(false);
  const [joining, setJoining] = useState(false);
  /** The ticked tags that belong to no world join this one - from then on they are the world's tags. */
  const joinWorld = async (world: TermOption, tags: TermOption[]) => {
    if (!world.slug || !onTermCreated || joining) return;
    const ok = await confirm({
      title: `Add ${tags.length} tag(s) to ${world.name}?`,
      description: `${tags.map((t) => t.name).join(", ")} - from now on these are tags of ${world.name}: every tour of that world offers them first, and after the next Revalidate the site lists them as sub-categories on the world's page. To take a tag out of a world, open it in Categories & Tags.`,
      confirmLabel: "Add to the world",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setJoining(true);
    const res = await run(
      () => addTagsToWorld({ termIds: tags.map((t) => t.id), worldSlug: world.slug as string }),
      (a) => `${a.data.filter((t) => t.worldSlug === world.slug).length} tag(s) are now tags of ${world.name}`,
    );
    setJoining(false);
    if (res.success) res.data.forEach(onTermCreated);
  };
  const worlds = terms.filter(
    (term) => term.kind === "audiences" && !!term.slug && (selected.has(term.id) || (!!brand && term.world?.key === brand)),
  );
  const worldSlugs = new Set(worlds.map((w) => w.slug));
  const worldNames = worlds.map((w) => w.name).join(", ");

  const tickList = (options: TermOption[]) => (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((term) => (
        <label key={term.id} className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={selected.has(term.id)} onCheckedChange={(on) => toggle(term.id, on === true)} />
          <span>{term.name}</span>
          {!term.isActive && <span className="text-xs text-muted-foreground">(Inactive)</span>}
        </label>
      ))}
    </div>
  );

  return (
    <>
      {PACKAGE_TERM_KINDS.map((kind) => {
        const options = terms.filter((term) => term.kind === kind);
        if (options.length === 0 && !(onTermCreated && MAIN_TERM_KINDS.includes(kind))) return null;
        const chosen = options.filter((term) => selected.has(term.id)).length;
        // tags follow the tour's worlds; a ticked tag stays in sight whatever its world
        const byWorld = kind === "tags" && worlds.length > 0;
        const ofWorld = byWorld ? options.filter((term) => !!term.worldSlug && worldSlugs.has(term.worldSlug)) : [];
        const narrowed = byWorld && ofWorld.length > 0;
        const shown = narrowed ? options.filter((term) => ofWorld.includes(term) || selected.has(term.id)) : options;
        const others = narrowed ? options.filter((term) => !shown.includes(term)) : [];
        // ticked here, and of no world yet: one click makes them tags of the tour's world
        const loose = byWorld ? options.filter((term) => selected.has(term.id) && !term.worldSlug) : [];
        return (
          <Section
            key={kind}
            title={`${TERM_KIND_LABELS[kind]} (${chosen})`}
            description={
              !byWorld
                ? undefined
                : narrowed
                  ? `The tags of the tour's world - ${worldNames}. A new tag is added to that world.`
                  : `No tag belongs to the tour's world (${worldNames}) yet, so every tag is shown. A new tag is added to that world.`
            }
            actions={
              onTermCreated && (
                <NewTermField
                  kind={kind}
                  worlds={byWorld ? worlds : []}
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
              <>
                {tickList(shown)}
                {onTermCreated && loose.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {worlds.slice(0, 3).map((world) => (
                      <Button
                        key={world.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={joining}
                        title={`Makes them tags of ${world.name}: every tour of that world then offers them first, and the site lists them under the world's page. A tag of another world is not touched.`}
                        onClick={() => void joinWorld(world, loose)}
                      >
                        {joining ? <Loader2 className="animate-spin" /> : <Plus />}
                        Add the {loose.length} ticked tag(s) with no world to {world.name}
                      </Button>
                    ))}
                  </div>
                )}
                {others.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <Button type="button" variant="ghost" size="sm" aria-expanded={showOtherTags} onClick={() => setShowOtherTags((v) => !v)}>
                      <ChevronDown className={showOtherTags ? "rotate-180 transition-transform" : "transition-transform"} />
                      {showOtherTags ? "Hide" : "Show"} the {others.length} other tags - of other worlds, or of none
                    </Button>
                    {showOtherTags && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Tick one to put it on this tour too. The tag keeps its own world; to move a tag to another world, open
                          it in Categories &amp; Tags.
                        </p>
                        {tickList(others)}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>
        );
      })}
    </>
  );
}
