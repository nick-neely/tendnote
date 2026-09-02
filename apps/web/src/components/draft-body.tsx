import { AssistantMarkdown } from "@/components/assistant-markdown";
import { cn } from "@/lib/utils";

/**
 * Read view of a draft's body. Drafts are stored as Markdown (plain text is valid
 * Markdown too), so they render through the same renderer Eve's own messages use — a
 * draft reads like the message it is, and a Markdown image in a model-written body
 * cannot reach the network on its own (see AssistantMarkdown). Shared by the in-chat draft
 * card and the person ledger so reading a draft looks the same everywhere it can be
 * edited. The prose stays capped at a comfortable line length.
 */
export function DraftBody({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-[68ch] text-[length:var(--text-body)] leading-[var(--text-body-line)]",
        className,
      )}
    >
      <AssistantMarkdown>{markdown}</AssistantMarkdown>
    </div>
  );
}
