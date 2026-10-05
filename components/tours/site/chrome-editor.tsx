"use client";

/**
 * Header & Footer of the company's site: the header menus, the mobile menu, the
 * footer, and the contact details every page shows. Three documents
 * (header, footer, general) behind one Save: only what changed is written.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useActionToast } from "@/hooks/use-action-toast";
import { Field, Notice, Section } from "@/components/tours/ui";
import { ImageUrlField, StringListEditor, moved } from "@/components/tours/content/fields";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { CONTENT_SAVED_NOTE, CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { saveSiteDoc, type SiteDocEditorData, type SiteEditorOptions } from "@/lib/actions/tours-site-actions";
import {
  SITE_DOC_SCHEMAS,
  type SiteFooter,
  type SiteGeneral,
  type SiteHeader,
  type SiteLink,
} from "@/lib/tours/site-content";
import { ItemList, LinkInput, LinkTree, pruneLinks } from "@/components/tours/site/site-fields";

type ChromeKey = "general" | "header" | "footer";
const KEYS: ChromeKey[] = ["header", "footer", "general"];
const KEY_LABELS: Record<ChromeKey, string> = { header: "Header", footer: "Footer", general: "Contact details" };

interface Forms {
  general: SiteGeneral;
  header: SiteHeader;
  footer: SiteFooter;
}
interface Saved {
  general: SiteDocEditorData<"general">;
  header: SiteDocEditorData<"header">;
  footer: SiteDocEditorData<"footer">;
}

/** The document as it is saved: rows nobody filled in are dropped. */
function cleaned<K extends ChromeKey>(key: K, form: Forms[K]): Forms[K] {
  if (key === "header") {
    const header = form as SiteHeader;
    return {
      menus: header.menus.map((menu) => ({ ...menu, items: pruneLinks(menu.items) })),
      links: pruneLinks(header.links),
      mobile: pruneLinks(header.mobile),
    } as Forms[K];
  }
  if (key === "footer") {
    const footer = form as SiteFooter;
    return {
      ...footer,
      discover: footer.discover.filter((tile) => tile.label.trim() !== "" || tile.href.trim() !== "" || tile.icon.trim() !== ""),
      columns: footer.columns.map((column) => ({ ...column, links: pruneLinks(column.links) })),
    } as Forms[K];
  }
  const general = form as SiteGeneral;
  return {
    ...general,
    addressShort: general.addressShort.filter((line) => line.trim() !== ""),
    hours: general.hours.filter((line) => line.trim() !== ""),
    leadOptions: general.leadOptions.filter((line) => line.trim() !== ""),
  } as Forms[K];
}

/** The mobile menu built from the header: every mega menu as an entry with its items, then the plain links. */
const mobileFromHeader = (header: SiteHeader): SiteLink[] => [
  ...header.menus.map((menu) => ({ label: menu.label, href: "#", children: menu.items as SiteLink[] })),
  ...(header.links as SiteLink[]),
];

function TextInput({ label, value, onChange, hint, ltr }: { label: string; value: string; onChange: (value: string) => void; hint?: string; ltr?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <Input dir={ltr ? "ltr" : "auto"} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function ChromeEditor({ initial, options }: { initial: Saved; options: SiteEditorOptions }) {
  const router = useRouter();
  const run = useActionToast();
  const [saved, setSaved] = useState<Saved>(initial);
  const [form, setForm] = useState<Forms>({ general: initial.general.form, header: initial.header.form, footer: initial.footer.form });
  const [isSaving, setIsSaving] = useState(false);

  const dirty = useMemo(() => KEYS.filter((key) => JSON.stringify(form[key]) !== JSON.stringify(saved[key].form)), [form, saved]);

  // what the server would refuse, said before the click
  const problem = useMemo(() => {
    for (const key of dirty) {
      const parsed = SITE_DOC_SCHEMAS[key].safeParse(cleaned(key, form[key]));
      if (!parsed.success) return `${KEY_LABELS[key]}: ${parsed.error.issues[0].message}`;
    }
    return null;
  }, [dirty, form]);

  const header = form.header;
  const footer = form.footer;
  const general = form.general;
  const setHeader = (change: Partial<SiteHeader>) => setForm((f) => ({ ...f, header: { ...f.header, ...change } }));
  const setFooter = (change: Partial<SiteFooter>) => setForm((f) => ({ ...f, footer: { ...f.footer, ...change } }));
  const setGeneral = (change: Partial<SiteGeneral>) => setForm((f) => ({ ...f, general: { ...f.general, ...change } }));

  const submit = async () => {
    if (isSaving || dirty.length === 0) return;
    setIsSaving(true);
    let next = saved;
    const nextForm = { ...form };
    const result = await run(async () => {
      for (const key of dirty) {
        const answer = await saveSiteDoc(key, cleaned(key, form[key]), next[key].updatedAt);
        if (!answer.success) return answer;
        next = { ...next, [key]: answer.data };
        (nextForm as Record<ChromeKey, unknown>)[key] = answer.data.form;
      }
      return { success: true as const, data: undefined };
    }, CONTENT_SAVED_NOTE);
    // a document that was saved before a later one failed keeps its new version
    setSaved(next);
    if (result.success) setForm(nextForm);
    setIsSaving(false);
    router.refresh();
  };

  const discard = () => setForm({ general: saved.general.form, header: saved.header.form, footer: saved.footer.form });

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title="Header & Footer"
        description="The menus at the top of every page, the footer, and the contact details the site shows. Save, then Revalidate Pages to show the change on the site."
        actions={
          <>
            <ViewOnSiteButton href={saved.general.siteUrl} />
            <PublishSiteButton />
          </>
        }
      />

      <Tabs defaultValue="header">
        <TabsList>
          <TabsTrigger value="header">Header menu</TabsTrigger>
          <TabsTrigger value="mobile">Mobile menu</TabsTrigger>
          <TabsTrigger value="footer">Footer</TabsTrigger>
          <TabsTrigger value="general">Contact details</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ header */}
        <TabsContent value="header" className="space-y-4">
          <Notice tone="info">
            Each menu opens a panel under the header. A link left empty only opens its sub-links. Use Pick to choose a page, a world, a tag, a
            destination or a tour of the site.
          </Notice>
          {header.menus.map((menu, index) => (
            <Section
              key={index}
              title={menu.label || `Menu ${index + 1}`}
              actions={
                <>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => setHeader({ menus: moved(header.menus, index, -1) })} aria-label="Move menu up" title="Move up">
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={index === header.menus.length - 1} onClick={() => setHeader({ menus: moved(header.menus, index, 1) })} aria-label="Move menu down" title="Move down">
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setHeader({ menus: header.menus.filter((_, i) => i !== index) })} aria-label="Remove menu" title="Remove menu">
                    <Trash2 />
                  </Button>
                </>
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                <TextInput label="Name in the header" value={menu.label} onChange={(label) => setHeader({ menus: header.menus.map((m, i) => (i === index ? { ...m, label } : m)) })} />
                <TextInput label="Heading inside the panel" hint="Empty = no heading." value={menu.heading} onChange={(heading) => setHeader({ menus: header.menus.map((m, i) => (i === index ? { ...m, heading } : m)) })} />
              </div>
              <LinkTree
                items={menu.items as SiteLink[]}
                onChange={(items) => setHeader({ menus: header.menus.map((m, i) => (i === index ? { ...m, items } : m)) })}
                options={options}
                depth={1}
              />
            </Section>
          ))}
          <Button type="button" variant="outline" disabled={header.menus.length >= 8} onClick={() => setHeader({ menus: [...header.menus, { label: "", heading: "", items: [] }] })}>
            <Plus />
            Add Menu
          </Button>
          <Section title="Plain links" description="Links that sit in the header next to the menus, with no panel.">
            <LinkTree items={header.links as SiteLink[]} onChange={(links) => setHeader({ links })} options={options} depth={0} />
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ mobile */}
        <TabsContent value="mobile" className="space-y-4">
          <Section
            title="Mobile menu"
            description="The menu that slides in on a phone. It has its own order, up to three levels."
            actions={
              <Button type="button" variant="outline" size="sm" onClick={() => setHeader({ mobile: mobileFromHeader(header) })} title="Replace the mobile menu with the header menus and links">
                <Copy />
                Copy from the Header Menu
              </Button>
            }
          >
            <LinkTree items={header.mobile as SiteLink[]} onChange={(mobile) => setHeader({ mobile })} options={options} depth={2} />
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ footer */}
        <TabsContent value="footer" className="space-y-4">
          <Section title="Tiles above the footer" description="The row of purple tiles, next to the newsletter box.">
            <TextInput label="Title" value={footer.discoverTitle} onChange={(discoverTitle) => setFooter({ discoverTitle })} />
            <ItemList
              items={footer.discover}
              onChange={(discover) => setFooter({ discover })}
              create={() => ({ label: "", href: "", icon: "" })}
              addLabel="Add Tile"
              max={8}
              render={(tile, patch) => (
                <div className="space-y-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input dir="auto" aria-label="Tile name" placeholder="Tile name" value={tile.label} onChange={(e) => patch({ label: e.target.value })} />
                    <LinkInput value={tile.href === "#" ? "" : tile.href} onChange={(href) => patch({ href })} options={options} />
                  </div>
                  <ImageUrlField label="Icon" value={tile.icon} onChange={(icon) => patch({ icon })} siteUrl={saved.footer.siteUrl} hint="A dark icon on a transparent background; the site paints it white." />
                </div>
              )}
            />
          </Section>
          <Section title="Newsletter box">
            <div className="grid gap-3 md:grid-cols-2">
              <TextInput label="Title" value={footer.newsletterTitle} onChange={(newsletterTitle) => setFooter({ newsletterTitle })} />
              <TextInput label="Line under the form" value={footer.newsletterNote} onChange={(newsletterNote) => setFooter({ newsletterNote })} />
            </div>
          </Section>
          <Section title="Link columns" description="The columns of the dark footer, right to left.">
            <TextInput label="Title above the social icons" value={footer.contactTitle} onChange={(contactTitle) => setFooter({ contactTitle })} />
            {footer.columns.map((column, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    dir="auto"
                    aria-label={`Heading of column ${index + 1}`}
                    placeholder="Column heading"
                    value={column.heading}
                    onChange={(e) => setFooter({ columns: footer.columns.map((c, i) => (i === index ? { ...c, heading: e.target.value } : c)) })}
                    className="font-medium"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === 0} onClick={() => setFooter({ columns: moved(footer.columns, index, -1) })} aria-label="Move column up" title="Move up">
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === footer.columns.length - 1} onClick={() => setFooter({ columns: moved(footer.columns, index, 1) })} aria-label="Move column down" title="Move down">
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={() => setFooter({ columns: footer.columns.filter((_, i) => i !== index) })} aria-label="Remove column" title="Remove column">
                    <Trash2 />
                  </Button>
                </div>
                <LinkTree
                  items={column.links as SiteLink[]}
                  onChange={(links) => setFooter({ columns: footer.columns.map((c, i) => (i === index ? { ...c, links } : c)) })}
                  options={options}
                  depth={0}
                />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={footer.columns.length >= 10} onClick={() => setFooter({ columns: [...footer.columns, { heading: "", links: [] }] })}>
              <Plus />
              Add Column
            </Button>
          </Section>
        </TabsContent>

        {/* ------------------------------------------------------------ contact details */}
        <TabsContent value="general" className="space-y-4">
          <Section title="The site" description="The name and the description search engines and social networks show for the home page.">
            <div className="grid gap-3 md:grid-cols-2">
              <TextInput label="Site name" value={general.name} onChange={(name) => setGeneral({ name })} />
              <TextInput label="Tagline" value={general.tagline} onChange={(tagline) => setGeneral({ tagline })} />
            </div>
            <Field label="Description" hint={`${general.description.length} characters. Up to 160 recommended.`}>
              <Textarea dir="auto" rows={2} value={general.description} onChange={(e) => setGeneral({ description: e.target.value })} />
            </Field>
            <ImageUrlField label="Logo" value={general.logo} onChange={(logo) => setGeneral({ logo })} siteUrl={saved.general.siteUrl} hint="The header and the footer paint it white." />
          </Section>
          <Section title="Contact details" description="Shown in the header icons, the footer, the contact page and the lead forms.">
            <div className="grid gap-3 md:grid-cols-3">
              <TextInput label="Phone" ltr value={general.phone} onChange={(phone) => setGeneral({ phone })} />
              <TextInput label="WhatsApp" ltr hint="The number only; the site builds the WhatsApp link." value={general.whatsapp} onChange={(whatsapp) => setGeneral({ whatsapp })} />
              <TextInput label="Fax" ltr value={general.fax} onChange={(fax) => setGeneral({ fax })} />
              <TextInput label="Email" ltr value={general.email} onChange={(email) => setGeneral({ email })} />
              <TextInput label="Address" value={general.address} onChange={(address) => setGeneral({ address })} />
              <TextInput label="Company and registration line" value={general.companyLegal} onChange={(companyLegal) => setGeneral({ companyLegal })} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <StringListEditor label="Address in the footer (two short lines)" value={general.addressShort} onChange={(addressShort) => setGeneral({ addressShort: addressShort.slice(0, 2) })} addLabel="Add Line" />
              <StringListEditor label="Opening hours" value={general.hours} onChange={(hours) => setGeneral({ hours: hours.slice(0, 6) })} addLabel="Add Line" />
            </div>
          </Section>
          <Section title="Social links" description="Full addresses (https://...). The icons in the header and the footer lead to them.">
            <div className="grid gap-3 md:grid-cols-3">
              <TextInput label="Facebook" ltr value={general.facebook} onChange={(facebook) => setGeneral({ facebook })} />
              <TextInput label="Instagram" ltr value={general.instagram} onChange={(instagram) => setGeneral({ instagram })} />
              <TextInput label="YouTube" ltr value={general.youtube} onChange={(youtube) => setGeneral({ youtube })} />
            </div>
          </Section>
          <Section title="Lead form" description={'The "did not find what you were looking for" form on the home page, the tour pages and the category pages.'}>
            <TextInput label="Title" value={general.leadTitle} onChange={(leadTitle) => setGeneral({ leadTitle })} />
            <StringListEditor label="Options of the trip type list" value={general.leadOptions} onChange={(leadOptions) => setGeneral({ leadOptions: leadOptions.slice(0, 12) })} addLabel="Add Option" />
          </Section>
          <Section title="Bottom line of the footer">
            <div className="grid gap-3 md:grid-cols-3">
              <TextInput label="Copyright line" value={general.copyright} onChange={(copyright) => setGeneral({ copyright })} />
              <TextInput label={'"Powered by" name'} value={general.poweredBy.label} onChange={(label) => setGeneral({ poweredBy: { ...general.poweredBy, label } })} />
              <TextInput label={'"Powered by" link'} ltr value={general.poweredBy.href} onChange={(href) => setGeneral({ poweredBy: { ...general.poweredBy, href } })} />
            </div>
          </Section>
        </TabsContent>
      </Tabs>

      <StickySaveBar
        isDirty={dirty.length > 0}
        isSaving={isSaving}
        onSave={() => void submit()}
        onDiscard={discard}
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message={CONTENT_UNSAVED_NOTE}
      />
    </div>
  );
}
