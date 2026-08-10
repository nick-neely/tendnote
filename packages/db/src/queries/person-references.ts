import { createDrizzlePersonReferenceStore } from "./person-references/drizzle-store";
import { createPersonReferences } from "./person-references/references";

export { createDrizzlePersonReferenceStore } from "./person-references/drizzle-store";
export { createInMemoryPersonReferenceStore } from "./person-references/in-memory-store";
export { createPersonReferences } from "./person-references/references";
export type { PersonReferenceHost, PersonReferenceStore } from "./person-references/types";

let references: ReturnType<typeof createPersonReferences> | null = null;

function personReferences() {
  references ??= createPersonReferences(createDrizzlePersonReferenceStore());
  return references;
}

/** Names an external person on one household-native coordination record. */
export const addPersonReference: ReturnType<typeof createPersonReferences>["addPersonReference"] = (
  input,
) => personReferences().addPersonReference(input);

/** Removes one reference from its own record. */
export const removePersonReference: ReturnType<
  typeof createPersonReferences
>["removePersonReference"] = (input) => personReferences().removePersonReference(input);

/** The references on one record, for a caller who may see that record. */
export const listPersonReferences: ReturnType<
  typeof createPersonReferences
>["listPersonReferences"] = (input) => personReferences().listPersonReferences(input);
