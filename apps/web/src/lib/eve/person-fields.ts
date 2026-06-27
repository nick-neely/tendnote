/** Human labels for the profile fields `update_person` can change. */
export const PERSON_FIELD_LABEL: Record<string, string> = {
  displayName: "name",
  firstName: "first name",
  lastName: "last name",
  birthday: "birthday",
  relationshipType: "relationship",
  closenessLevel: "closeness",
  profileBlurb: "description",
};

const fieldListFormatter = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Joins humanized field labels into one sentence ("name and birthday"). */
export function formatFieldList(fields: string[]): string {
  return fieldListFormatter.format(fields);
}
