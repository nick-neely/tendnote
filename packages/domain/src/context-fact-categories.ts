/** User-facing categories available for direct Self Context management. */
export const selfContextFactCategories = [
  "background",
  "work",
  "location",
  "interest",
  "preference",
  "constraint",
  "other",
] as const;

export const contextFactCategoryLabels = {
  background: "Background",
  work: "Work",
  location: "Location",
  interest: "Interest",
  preference: "Preference",
  constraint: "Constraint",
  composition: "Composition",
  other: "Other",
} as const;

export type ContextFactCategoryLabel = keyof typeof contextFactCategoryLabels;

export function contextFactCategoryLabel(category: ContextFactCategoryLabel): string {
  return contextFactCategoryLabels[category];
}
