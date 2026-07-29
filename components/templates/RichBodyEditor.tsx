"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Unlink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrompt } from "@/components/confirm-provider";

/**
 * Rich body editor for Template forms (blog). Visual tab = TipTap; HTML tab =
 * raw source. Parent owns the value as an HTML string and converts to/from the
 * Contentful doc at the save/load boundary (lib/richtext.ts). Only the node set
 * the converters support is offered: h1-h3, p, ul, ol, blockquote, a, bold,
 * italic.
 */
export function RichBodyEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const prompt = usePrompt();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        underline: false,
      }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        dir: "auto",
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[300px] rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // External value change (auto-fill, HTML-tab edits, discard) → sync editor.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  const setLink = async () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await prompt({
      title: "Link URL",
      description: "Leave it empty to remove the link.",
      label: "URL",
      defaultValue: prev ?? "https://",
    });
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const toggle = (active: boolean | undefined) =>
    active ? "bg-accent text-accent-foreground" : "";

  return (
    <Tabs defaultValue="visual" className="w-full">
      <TabsList>
        <TabsTrigger value="visual">Visual</TabsTrigger>
        <TabsTrigger value="html">HTML</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="space-y-2">
        {editor && (
          <div className="flex flex-wrap items-center gap-1 rounded-md border p-1">
            {([1, 2, 3] as const).map((level) => (
              <Button
                key={level}
                type="button"
                variant="ghost"
                size="sm"
                className={toggle(editor.isActive("heading", { level }))}
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level }).run()
                }
              >
                H{level}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={toggle(editor.isActive("bold"))}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={toggle(editor.isActive("italic"))}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={toggle(editor.isActive("bulletList"))}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={toggle(editor.isActive("orderedList"))}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={toggle(editor.isActive("blockquote"))}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={toggle(editor.isActive("link"))}
              onClick={() => void setLink()}
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!editor.isActive("link")}
              onClick={() => editor.chain().focus().unsetLink().run()}
            >
              <Unlink className="h-4 w-4" />
            </Button>
          </div>
        )}
        <EditorContent editor={editor} />
      </TabsContent>

      <TabsContent value="html">
        <Textarea
          dir="ltr"
          rows={16}
          className="font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </TabsContent>
    </Tabs>
  );
}
