"use client";

import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BoldIcon, CheckIcon, ItalicIcon, ListIcon, ListOrderedIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { draftEditorExtensions, getEditorMarkdown } from "@/lib/draft-markdown";
import { cn } from "@/lib/utils";

/**
 * Shared inline WYSIWYG editor for a Tendnote draft. Every surface where a draft
 * can be edited — the in-chat draft card and the person ledger — mounts this one
 * component, so editing, Markdown round-tripping, and the formatting affordances
 * never fork. The draft is stored as Markdown; Tiptap parses it on open and
 * `getMarkdown()` serializes it back on save. It owns its Save/Cancel controls so
 * the affordance is identical everywhere; the parent only decides what saving and
 * cancelling do (persisting, handling an unchanged or empty edit, surfacing errors).
 */
export function DraftEditor({
  markdown,
  onSave,
  onCancel,
  saving = false,
  ariaLabel = "Edit draft message",
}: {
  markdown: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
  saving?: boolean;
  ariaLabel?: string;
}) {
  const editor = useEditor({
    extensions: draftEditorExtensions,
    content: markdown,
    // Next.js renders this on the server first; defer to the client to avoid a
    // hydration mismatch (Tiptap is DOM-bound).
    immediatelyRender: false,
    autofocus: "end",
    editorProps: {
      attributes: { "aria-label": ariaLabel, class: "focus:outline-none" },
    },
  });

  function handleSave() {
    if (!editor || saving) {
      return;
    }
    onSave(getEditorMarkdown(editor).trim());
  }

  // Keyboard-first: ⌘/Ctrl+Enter saves, Escape cancels, matching the rest of the
  // app's keyboard operability (DESIGN.md §8).
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSave();
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a keyboard shortcut (save/cancel) over the already-focusable contenteditable child, not an interactive control itself.
    <div className="tn-rich-editor flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <DraftEditorToolbar editor={editor} />
      <EditorContent
        className="min-h-[4.5rem] rounded-lg border bg-background px-3 py-2.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
        editor={editor}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={saving || !editor} onClick={handleSave} size="sm" type="button">
          <CheckIcon />
          Save
        </Button>
      </div>
    </div>
  );
}

/** Minimal formatting bar: the handful of marks an email-style note actually uses. */
function DraftEditorToolbar({ editor }: { editor: Editor | null }) {
  return (
    <div className="flex items-center gap-0.5">
      <ToolbarToggle
        active={Boolean(editor?.isActive("bold"))}
        disabled={!editor}
        label="Bold"
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <BoldIcon />
      </ToolbarToggle>
      <ToolbarToggle
        active={Boolean(editor?.isActive("italic"))}
        disabled={!editor}
        label="Italic"
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolbarToggle>
      <Separator className="mx-1 data-[orientation=vertical]:h-4" orientation="vertical" />
      <ToolbarToggle
        active={Boolean(editor?.isActive("bulletList"))}
        disabled={!editor}
        label="Bulleted list"
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <ListIcon />
      </ToolbarToggle>
      <ToolbarToggle
        active={Boolean(editor?.isActive("orderedList"))}
        disabled={!editor}
        label="Numbered list"
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrderedIcon />
      </ToolbarToggle>
    </div>
  );
}

function ToolbarToggle({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className={cn(active && "bg-muted text-foreground")}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}
