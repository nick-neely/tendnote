/**
 * Plain-language labels for a Source Record's `sourceType`, so a review surface can say
 * where a suggestion came from ("From manual note") without exposing the raw enum. Shared
 * by the suggested-follow-up and Suggested-action review cards so the two never drift.
 */
const SOURCE_LABELS: Record<string, string> = {
  manual: "manual note",
  agent: "assistant note",
  contact_import: "imported contact",
  calendar: "calendar",
  gmail: "email",
  seed: "sample data",
};

/** The label for a source type, falling back to the raw type when it is unmapped. */
export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}
