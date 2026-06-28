import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/**
 * The one Tiptap extension set the draft editor and its read/copy helpers share,
 * so Markdown parses and serializes identically whether a draft is being edited,
 * read, or copied. Kept minimal and email-shaped: prose, light emphasis, links,
 * and simple lists — not a document editor.
 */
export const draftEditorExtensions = [
  StarterKit,
  Markdown.configure({
    html: false,
    tightLists: true,
    linkify: true,
    transformPastedText: true,
  }),
];

/**
 * Converts a draft's stored Markdown into the rich/plain pair the clipboard needs,
 * using a throwaway headless editor so the output exactly matches what the user
 * sees and edits. Built for the Copy action: pasting into an email keeps the
 * formatting (text/html), and anywhere else falls back to clean prose (text/plain),
 * never raw Markdown symbols. Browser-only — the copy handler is the sole caller.
 */
/**
 * Reads the editor's content back as Markdown. tiptap-markdown adds this to the
 * editor storage at runtime but (in 0.9) doesn't augment the `Storage` type, so we
 * narrow it here in one place instead of casting at every call site.
 */
export function getEditorMarkdown(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}

export function draftMarkdownToClipboard(markdown: string): { html: string; text: string } {
  const editor = new Editor({ extensions: draftEditorExtensions, content: markdown });
  try {
    return { html: editor.getHTML(), text: editor.getText() };
  } finally {
    editor.destroy();
  }
}

/**
 * Copies a draft to the clipboard as both rich HTML and plain text, so pasting
 * into an email keeps the formatting and pasting anywhere else still drops clean
 * prose. Falls back to plain text where the rich Clipboard API is unavailable.
 * Shared by every draft surface so Copy behaves identically in chat and on the
 * person ledger. Throws if the clipboard write fails so callers can show an error.
 */
export async function copyDraftToClipboard(markdown: string): Promise<void> {
  const { html, text } = draftMarkdownToClipboard(markdown);

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Some browsers reject multi-type writes; fall back to plain text below.
    }
  }

  await navigator.clipboard.writeText(text);
}
