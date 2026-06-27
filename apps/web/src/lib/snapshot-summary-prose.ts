/**
 * The relationship snapshot summary is generated prose (#14): a deterministic
 * generator today, an LLM adapter tomorrow. Models leak Markdown into that prose
 * even when the prompt asks for plain text — a leading `# Name` heading, a
 * `**Relationship | Role**` label line, stray inline `**bold**`/`*italic*`.
 *
 * The snapshot card renders the summary as plain text inside the controlled
 * Personal Ledger typography (it does NOT render Markdown), so those tokens show
 * up literally. Rather than cede typographic control to a non-deterministic
 * model, we normalize the prose at the read boundary: strip Markdown structure
 * the card already owns and flatten inline emphasis to text. The card's own
 * heading and the page header already state the person's name and relationship,
 * so a leading heading or label line is pure duplication and is dropped.
 *
 * This is display-only normalization (ADR 0009): it never edits the stored
 * snapshot, only what the read-only card shows.
 */

const HEADING = /^#{1,6}\s+/;
const HORIZONTAL_RULE = /^\s*([-*_])\1{2,}\s*$/;
// An entire line wrapped in bold — a label/heading surrogate, not prose.
const STANDALONE_BOLD_LINE = /^\s*(\*\*|__)(.+)\1\s*$/;
const BLOCKQUOTE = /^\s*>\s?/;
const UNORDERED_MARKER = /^(\s*)[-*+]\s+/;

function isLeadingChrome(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    HEADING.test(trimmed) ||
    HORIZONTAL_RULE.test(trimmed) ||
    STANDALONE_BOLD_LINE.test(trimmed)
  );
}

function flattenInline(line: string): string {
  return (
    line
      // Images before links so alt text survives and the URL is dropped.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Bold before italic so `**x**` isn't mis-read as nested `*`.
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // Italic: only `*x*` — single `_` is left alone to spare snake_case words.
      .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
  );
}

function flattenBlock(line: string): string {
  let next = line.replace(HEADING, "").replace(BLOCKQUOTE, "");
  // Keep an intentional list readable without the raw Markdown marker.
  next = next.replace(UNORDERED_MARKER, "$1• ");
  return flattenInline(next).trimEnd();
}

/**
 * Normalize generated snapshot prose into clean plain text for the read-only
 * card. Strips a leading heading / label block (the card and page header already
 * name the person and relationship), removes block Markdown markers, flattens
 * inline emphasis, and collapses runs of blank lines. Returns `""` when nothing
 * but chrome remains, so the caller can fall back instead of showing an empty
 * card.
 */
export function sanitizeSnapshotSummary(summary: string): string {
  const lines = summary.replace(/\r\n?/g, "\n").split("\n");

  // Drop the leading chrome block: heading, rules, and label lines the card
  // duplicates. Stop at the first real prose line.
  let start = 0;
  while (start < lines.length && isLeadingChrome(lines[start] ?? "")) {
    start += 1;
  }

  const body: string[] = [];
  for (const line of lines.slice(start)) {
    const trimmed = line.trim();
    if (HORIZONTAL_RULE.test(trimmed)) {
      continue;
    }
    body.push(flattenBlock(line));
  }

  return (
    body
      .join("\n")
      // Collapse 3+ newlines (with optional surrounding whitespace) to a single
      // blank line so paragraph rhythm stays even.
      .replace(/\n[ \t]*\n[ \t]*(\n[ \t]*)+/g, "\n\n")
      .trim()
  );
}
