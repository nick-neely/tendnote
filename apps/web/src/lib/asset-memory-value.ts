import type { AssetMemoryEdit, AssetMemoryValue } from "@tendnote/domain";

/**
 * The one codec for typed Asset Memory values (#198): how a value is *formatted*
 * for reading, *drafted* into an editable string, and *parsed* back from a
 * draft. Format, draft, and parse live together so the three can never disagree
 * about what a value type means — the review card, the group view, and the
 * Asset Profile all read from here.
 */

/** Formats a typed memory value for calm display. Exact facts, plainly rendered. */
export function formatAssetMemoryValue(value: AssetMemoryValue | null): string | null {
  if (value === null) {
    return null;
  }
  if (value.type === "text") {
    return value.text;
  }
  if (value.type === "date") {
    // A plain calendar date — parse as local so the day never shifts.
    const [year, month, day] = value.date.split("-").map(Number);
    if (!year || !month || !day) {
      return value.date;
    }
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(
      value.amount,
    );
  } catch {
    return `${value.amount} ${value.currency}`;
  }
}

/** The editable text form of a typed value: what lands in the one value input. */
export function valueDraftFor(value: AssetMemoryValue | null): string {
  if (value === null) {
    return "";
  }
  if (value.type === "text") {
    return value.text;
  }
  if (value.type === "date") {
    return value.date;
  }
  return String(value.amount);
}

/**
 * A parsed draft: either a valid typed value (or a deliberate clear to `null`),
 * or invalid input the surface must surface and refuse to submit — an invalid
 * draft can never silently fall back to the original value.
 */
export type DraftValueResult =
  | { ok: true; value: AssetMemoryValue | null }
  | { ok: false; message: string };

/**
 * Rebuilds the typed value from the draft input, preserving the value's type —
 * a review edit corrects an extracted fact, it never re-models it. An emptied
 * input clears the value (`null`), which the substance guard then vets; a
 * malformed one is rejected, never quietly replaced by the original.
 */
export function draftToValue(current: AssetMemoryValue | null, draft: string): DraftValueResult {
  const trimmed = draft.trim();
  if (current === null || trimmed === "") {
    return { ok: true, value: null };
  }
  if (current.type === "text") {
    return { ok: true, value: { type: "text", text: trimmed } };
  }
  if (current.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return { ok: false, message: "Enter a valid date." };
    }
    return { ok: true, value: { type: "date", date: trimmed } };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: "Enter a valid amount." };
  }
  return { ok: true, value: { type: "amount", amount, currency: current.currency } };
}

/** The draft strings behind one detail's edit form. */
export type AssetMemoryDraft = { label: string; value: string; notes: string };

/**
 * Everything the edit form derives from a draft: what changed, whether the edit
 * keeps substance (a memory may not lose both its value and its notes), whether
 * the value input parses at all, and the minimal edit payload to send. Invalid
 * input disables *both* Apply and Accept — accepting must never submit the
 * original value while the input shows rejected text.
 */
export function deriveMemoryDraft(
  memory: { label: string; value: AssetMemoryValue | null; notes: string | null },
  draft: AssetMemoryDraft,
): {
  canApply: boolean;
  canAccept: boolean;
  invalidMessage: string | null;
  buildEdit: () => AssetMemoryEdit;
} {
  const trimmedLabel = draft.label.trim();
  const trimmedNotes = draft.notes.trim();
  const parsed = draftToValue(memory.value, draft.value);
  if (!parsed.ok) {
    return {
      canApply: false,
      canAccept: false,
      invalidMessage: parsed.message,
      buildEdit: () => ({}),
    };
  }

  const labelChanged = trimmedLabel !== memory.label && trimmedLabel.length > 0;
  const valueChanged = JSON.stringify(parsed.value) !== JSON.stringify(memory.value);
  const notesChanged = trimmedNotes !== (memory.notes ?? "");
  const changed = labelChanged || valueChanged || notesChanged;
  const substantial = parsed.value !== null || trimmedNotes.length > 0;

  return {
    canApply: trimmedLabel.length > 0 && changed && substantial,
    canAccept: trimmedLabel.length > 0 && substantial,
    invalidMessage: null,
    buildEdit: () => ({
      ...(labelChanged ? { label: trimmedLabel } : {}),
      ...(valueChanged ? { value: parsed.value } : {}),
      ...(notesChanged ? { notes: trimmedNotes ? trimmedNotes : null } : {}),
    }),
  };
}
