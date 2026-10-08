"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, SortableHeader } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { createTourCmsPage, saveTourCmsPage } from "@/lib/actions/tours-content-actions";
import { ActiveChip, Field, Notice, Section } from "@/components/tours/ui";
import { activeColumn, contentColumn, editColumn } from "@/components/tours/content/columns";
import { ImageUrlField } from "@/components/tours/content/fields";
import { EasyTextEditor } from "@/components/tours/content/easy-text-editor";
import { HtmlField } from "@/components/tours/content/html-field";
import { FooterTilesField, pruneTiles } from "@/components/tours/site/site-fields";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import {
  CMS_PAGE_KINDS,
  cmsPageKindLabel,
  siteAssetUrl,
  type CmsPageEditorData,
  type CmsPageForm,
  type CmsPageKind,
  type CmsPageListRow,
} from "@/components/tours/content/shared";
import { PICTURE_TILE_MODES, PICTURE_TILE_MODE_LABELS, type PictureTileMode } from "@/lib/tours/site-content";
import { cn } from "@/lib/utils";
import { selectClass } from "@/components/tours/ui";
import type { EasyLayout } from "@/lib/tours/wp-html";

/** The imported pages that draw the row of picture tiles ("הכי חמים") near their bottom - a post does too. */
const PICTURE_TILE_LAYOUTS: EasyLayout[] = ["about", "faq", "faq_home", "leaders"];

const KIND_VIEW_LABELS: Record<CmsPageKind, string> = { page: "Pages", post: "Blog posts" };
const isKind = (value: unknown): value is CmsPageKind => CMS_PAGE_KINDS.includes(value as CmsPageKind);
const KIND_STATE = "kind";

/** The free content pages of the site (about, FAQ, legal, contact) and its blog posts, on the shared DataTable. */
export function CmsPagesTable({ rows }: { rows: CmsPageListRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useSessionState<CmsPageKind>(KIND_STATE, "page", isKind);

  const byKind = useMemo(() => {
    const map = new Map<string, CmsPageListRow[]>();
    for (const row of rows) map.set(row.kind, [...(map.get(row.kind) ?? []), row]);
    return map;
  }, [rows]);

  const columns = useMemo<ColumnDef<CmsPageListRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <SortableHeader label="Title" column={column} />,
        cell: ({ row }) => (
          <Link href={`/tours/pages/${row.original.id}`} className="font-medium hover:underline">
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "path",
        header: ({ column }) => <SortableHeader label="Address" column={column} />,
        cell: ({ row }) => (
          <span dir="ltr" className="inline-block text-xs text-muted-foreground">
            {row.original.path}
          </span>
        ),
      },
      contentColumn(),
      activeColumn(),
      editColumn(
        (row) => `/tours/pages/${row.id}`,
        (row) => row.title,
      ),
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={byKind.get(kind) ?? []}
      searchColumns={["title", "path"]}
      searchPlaceholder="Search by title or address"
      defaultPageSize={50}
      getRowId={(row) => row.id}
      views={CMS_PAGE_KINDS.map((k) => ({ id: k, label: KIND_VIEW_LABELS[k], count: byKind.get(k)?.length ?? 0 }))}
      activeView={kind}
      onViewChange={(id) => setKind(id as CmsPageKind)}
      onRowClick={(row) => router.push(`/tours/pages/${row.id}`)}
      stateKey="tours-cms-pages"
      emptyState={{
        title: kind === "post" ? "No blog posts yet" : "No content pages yet",
        description: "Add one with Add Page or Post at the top of the page.",
      }}
    />
  );
}

/** "Add Page or Post" in the page header: kind + title, then the new page's editor to write it. */
export function AddCmsPageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusCircle className="me-2 h-4 w-4" />
        Add Page or Post
      </Button>
      {open && <AddCmsPageDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCmsPageDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<CmsPageKind>("page");
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const run = useActionToast();
  const problem = !title.trim() ? "Enter a title" : null;

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (problem || isPending) return;
    startTransition(async () => {
      const result = await run(() => createTourCmsPage({ kind, title: title.trim() }), kind === "post" ? "Post created" : "Page created");
      if (result.success) router.push(`/tours/pages/${result.data.id}`);
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader className="pt-4 text-start sm:text-start">
            <DialogTitle>Add Page or Post</DialogTitle>
            <DialogDescription>It opens in its editor next, where you write it and switch it on.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {CMS_PAGE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                disabled={isPending}
                className={`rounded-md border p-3 text-start text-sm ${kind === k ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted"}`}
              >
                <span className="block">{k === "post" ? "Blog post" : "Page"}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {k === "post" ? "Listed in the blog, newest first." : "A page of its own: a guide, a campaign, information."}
                </span>
              </button>
            ))}
          </div>
          <Field label="Title" htmlFor="new-page-title" hint="The address is made from the title. You can change it in the editor.">
            <Input id="new-page-title" dir="auto" autoFocus maxLength={500} value={title} disabled={isPending} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || isPending} title={problem ?? undefined}>
              {isPending && <Loader2 className="animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Editor of one content page. A page that came from WordPress keeps its address; one made here can change it. */
export function CmsPageFormEditor({ initial }: { initial: CmsPageEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<CmsPageForm, CmsPageEditorData>(
    initial,
    // tiles nobody filled in are dropped before the save
    (values) => saveTourCmsPage(initial.id, { ...values, footerTiles: { ...values.footerTiles, items: pruneTiles(values.footerTiles.items) } }),
  );
  const isPost = saved.kind === "post";
  const problem = !form.title.trim() ? "Title is required" : saved.created && !form.path.trim() ? "The page needs an address" : null;
  const liveUrl = saved.form.isActive ? siteAssetUrl(saved.siteUrl, saved.path) : null;
  // the pages that draw the picture tiles near their bottom get the choice to drop them
  const hasPictureTiles = isPost || (saved.easyLayout !== null && PICTURE_TILE_LAYOUTS.includes(saved.easyLayout));

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/pages">Back to Content Pages</BackLink>
      <PageHeader
        eyebrow={isPost ? "Blog post" : cmsPageKindLabel(saved.kind)}
        title={saved.form.title}
        description={<ActiveChip active={saved.form.isActive} />}
        actions={
          <>
            <ViewOnSiteButton href={liveUrl} />
            <PublishSiteButton />
          </>
        }
      />

      {saved.created && !saved.form.isActive && (
        <Notice tone="warning">
          This {isPost ? "post" : "page"} is not on the site yet. Write it, switch on Active on site, save, and click Revalidate Pages.
        </Notice>
      )}

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Title" className="md:col-span-2">
            <Input dir="auto" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field
            label="Address on the site"
            hint={saved.created ? "Starts and ends with /. A hyphen between words, no spaces." : "Fixed: this page came with the site, and menus and other pages link to it."}
          >
            <Input dir="ltr" value={saved.created ? form.path : saved.path} readOnly={!saved.created} disabled={!saved.created} onChange={(e) => set("path", e.target.value)} />
          </Field>
          <div className="flex items-center gap-3 self-start rounded-md border p-3 md:mt-6">
            <Switch id="page-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            <label htmlFor="page-active" className="text-sm font-medium">
              Active on site
            </label>
          </div>
        </div>
        {(saved.created || isPost) && (
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Opening line" hint="Optional. A short bold line above the text." className="md:col-span-3">
              <Textarea dir="auto" rows={2} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
            </Field>
            {isPost && (
              <Field label="Date" hint="The blog lists the newest post first.">
                <Input type="date" dir="ltr" value={form.date} onChange={(e) => set("date", e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </Section>

      {saved.note ? (
        // an imported address with no words of its own: say where its content lives instead of showing an editor
        <Notice tone="info">
          {saved.note.note}
          {saved.note.href && (
            <>
              {" "}
              <Link href={saved.note.href} className="font-medium underline">
                {saved.note.linkLabel ?? "Open"}
              </Link>
            </>
          )}
        </Notice>
      ) : (
        <Section description={isPost ? "The picture at the top of the post and on its tile in the blog." : "The picture at the top of the page, behind the title. Empty = the site's default picture."}>
          <ImageUrlField label="Picture" value={form.image} onChange={(image) => set("image", image)} siteUrl={saved.siteUrl} folder="pages" />
        </Section>
      )}

      {saved.note ? null : saved.easyLayout ? (
        // an imported page: its words in plain fields instead of its HTML
        <EasyTextEditor layout={saved.easyLayout} value={form.easy} onChange={(easy) => set("easy", easy)} siteUrl={saved.siteUrl} />
      ) : (
        <Section>
          {!saved.created && !isPost && (
            <Notice tone="info">
              This page came with the site and has no plain editor yet, so its content is edited as HTML. The preview under the field shows what the HTML holds.
            </Notice>
          )}
          <HtmlField
            label={isPost ? "Post content" : "Page content"}
            value={form.contentHtml}
            onChange={(value) => set("contentHtml", value)}
            siteUrl={saved.siteUrl}
            rows={22}
            hint={
              saved.created
                ? "Write with the visual editor: headings, lists, links, bold and italic. The site adds its own styling."
                : "The preview shows the content without the site's styling, so a page imported from WordPress looks plainer here than on the site."
            }
          />
        </Section>
      )}

      {saved.easyLayout === "blog" && (
        <Section
          title={`Posts in the blog (${saved.posts.length})`}
          description='The blog lists every post that is "Active on site", newest first, by itself: a post is in the blog by being a post. To add one, click "Add Page or Post" on the list of Content Pages and choose "Blog post".'
        >
          {saved.posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {saved.posts.map((post) => (
                <li key={post.id}>
                  <Link href={`/tours/pages/${post.id}`} className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm hover:bg-muted", !post.isActive && "text-muted-foreground")}>
                    <span dir="auto">{post.title}</span>
                    {post.date && <span className="text-xs text-muted-foreground">{post.date}</span>}
                    {!post.isActive && <span className="text-xs">(off)</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/tours/pages" className="text-sm font-medium underline">
            Open the list of Content Pages
          </Link>
        </Section>
      )}

      {!saved.note && (
        <Section title="Tiles above the footer" description={`What this ${isPost ? "post" : "page"} shows above the footer.`}>
          <FooterTilesField value={form.footerTiles} onChange={(footerTiles) => set("footerTiles", footerTiles)} options={saved.options} siteUrl={saved.siteUrl} />
          {hasPictureTiles && (
            <Field
              label='Picture tiles ("הכי חמים")'
              hint="The row of picture tiles near the bottom of this page. The tiles themselves, and whether they show at all, are set in Header & Footer > Footer > Picture tiles."
              className="md:max-w-md"
            >
              <select value={form.pictureTiles} onChange={(e) => set("pictureTiles", e.target.value as PictureTileMode)} className={cn(selectClass, "w-full")}>
                {PICTURE_TILE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {PICTURE_TILE_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Section>
      )}

      <Section title="SEO" description="What search engines and social networks show for this page.">
        <Field label="Title" hint={`${form.seoTitle.length} characters. Up to 60 recommended.`}>
          <Input dir="auto" value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
        </Field>
        <Field label="Description" hint={`${form.seoDescription.length} characters. Up to 160 recommended.`}>
          <Textarea dir="auto" rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
        </Field>
      </Section>

      <StickySaveBar
        isDirty={isDirty}
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
