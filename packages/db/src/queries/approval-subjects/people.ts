import { z } from "zod";
import { getPerson } from "../people";
import { type ApprovalSubjectDescribers, defineSubject, detail, subject } from "./define";

/**
 * The profile fields `update_person` can change, in the order the owner reads
 * them and under the names the app uses for them.
 *
 * The patch is described field by field rather than as a blob because the
 * finding this gate answers is precisely that the model authors it: "change
 * Mara's birthday to 1970-01-01" and "rename Sam to Samuel" have to be visibly
 * different decisions.
 */
const PATCH_LABELS = [
  ["displayName", "Name"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["birthday", "Birthday"],
  ["relationshipType", "Relationship"],
  ["closenessLevel", "Closeness"],
  ["profileBlurb", "Description"],
] as const;

export const peopleApprovalSubjects: ApprovalSubjectDescribers = {
  update_person: defineSubject({
    // Loose on purpose: the patch fields are read by name below, and a field the
    // tool grows later shows up as an unlisted change rather than a parse error
    // that would deny every call.
    schema: z.object({ personId: z.uuid() }).loose(),
    load: (input, ownerUserId) => getPerson({ ownerUserId, personId: input.personId }),
    describe: (person, input) =>
      subject(
        `Change ${person.displayName}'s profile`,
        PATCH_LABELS.map(([field, label]) => {
          const value = input[field];
          if (value === undefined) return null;
          return detail(label, value === null ? "(cleared)" : String(value));
        }),
      ),
  }),
};
