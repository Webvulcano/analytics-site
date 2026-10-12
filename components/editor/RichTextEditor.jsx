"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { isSafeHref, sanitizeDoc } from "@/client-kit/lib/cms-richtext";

// Minimal rich text: bold, italic, link, bullet/numbered list (+ H2/H3 with `headings`, e.g. blog posts).
// Output is sanitized with the same allowlist the websites render with. Remount (key) to load a different value.
export default function RichTextEditor({ value, onChange, disabled, id, headings = false, minHeight = "min-h-32" }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: headings ? { levels: [2, 3] } : false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto", "tel"] },
      }),
    ],
    content: sanitizeDoc(value),
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(sanitizeDoc(editor.getJSON())),
    editorProps: {
      attributes: {
        id,
        class:
          `${minHeight} px-3 py-2 text-sm leading-relaxed outline-none [&_a]:text-indigo-600 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold`,
      },
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            link: editor.isActive("link"),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            h2: editor.isActive("heading", { level: 2 }),
            h3: editor.isActive("heading", { level: 3 }),
          }
        : {},
  });

  if (!editor) return <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />;

  function editLink() {
    const current = editor.getAttributes("link").href ?? "";
    const href = window.prompt("Link címe (https://…, tel:…, mailto:…). Üresen hagyva törli a linket.", current);
    if (href === null) return;
    if (href.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const url = /^(https?:|mailto:|tel:|\/|#)/i.test(href.trim()) ? href.trim() : `https://${href.trim()}`;
    if (!isSafeHref(url)) {
      window.alert("Ez a link nem engedélyezett.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const btn = (active) =>
    `rounded px-2 py-1 text-xs font-medium ${
      active ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    }`;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800" role="toolbar" aria-label="Formázás">
        {headings && (
          <>
            <button type="button" disabled={disabled} className={btn(state.h2)} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={state.h2} title="Alcím">
              H2
            </button>
            <button type="button" disabled={disabled} className={btn(state.h3)} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={state.h3} title="Kisebb alcím">
              H3
            </button>
          </>
        )}
        <button type="button" disabled={disabled} className={btn(state.bold)} onClick={() => editor.chain().focus().toggleBold().run()} aria-pressed={state.bold}>
          <strong>F</strong>
        </button>
        <button type="button" disabled={disabled} className={btn(state.italic)} onClick={() => editor.chain().focus().toggleItalic().run()} aria-pressed={state.italic}>
          <em>D</em>
        </button>
        <button type="button" disabled={disabled} className={btn(state.link)} onClick={editLink} aria-pressed={state.link}>
          Link
        </button>
        <button type="button" disabled={disabled} className={btn(state.bullet)} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-pressed={state.bullet}>
          • Lista
        </button>
        <button type="button" disabled={disabled} className={btn(state.ordered)} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-pressed={state.ordered}>
          1. Lista
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
