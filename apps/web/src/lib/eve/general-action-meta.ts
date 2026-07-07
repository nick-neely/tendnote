import { formatFieldList } from "@/lib/eve/person-fields";

/**
 * The calm meta line shared by every General Action surface in chat — the created-action
 * card, the ledger-list rows, and the suggested-action review card. Each builds its own
 * timing phrase (a ledger row's resolved surfacing label, a proposal's "Proposed for …"),
 * but the linked-people formatting and the dot-joining are shared here so the surfaces
 * can't drift on punctuation (they once split on "A, B and C" vs "A, B, C").
 */

/** "With Sam" / "With Sam and Priya" / null when no people are linked. */
export function formatLinkedPeople(personNames: string[]): string | null {
  return personNames.length > 0 ? `With ${formatFieldList(personNames)}` : null;
}

/** Joins the present parts of a meta line with " · "; null when nothing is present. */
export function joinGeneralActionMeta(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length > 0 ? kept.join(" · ") : null;
}
