import { z } from "zod";

/**
 * Long enough for "Dr. Alvarez at the clinic", short enough that nobody
 * mistakes the field for a notes box. A Person Reference is a label, and a cap
 * this low is part of how it stays one.
 */
export const PERSON_REFERENCE_LABEL_MAX_LENGTH = 80;

export const PERSON_REFERENCE_CONTACT_DETAIL_MESSAGE = "Use a name, not contact details.";

/** A refusal about the label itself, safe to render beside the field. */
export class PersonReferenceValidationError extends Error {
  override readonly name = "PersonReferenceValidationError";
}

/**
 * The household-native records that may name an external person.
 *
 * Deliberately excludes memories, source records, and follow-ups: those are
 * member-owned relationship records that already point at a real Person the
 * owner keeps privately, and letting one carry a reference as well would create
 * a second, shakier identity for the same human inside the product.
 */
export const personReferenceRecordKindSchema = z.enum(["general_action", "saved_item", "asset"]);
export type PersonReferenceRecordKind = z.infer<typeof personReferenceRecordKindSchema>;

/**
 * Whether a label is really contact data wearing a name's clothes.
 *
 * A Person Reference that accumulates emails and phone numbers is a shared
 * address book, which is the exact thing ADR 0218 refuses to build. Detecting
 * that at the label boundary is cruder than a policy engine and far harder to
 * route around: there is nowhere else for the data to enter.
 */
function looksLikeContactDetail(value: string): boolean {
  if (/\S+@\S+\.\S+/.test(value)) return true;
  if (/https?:\/\//i.test(value) || /\bwww\./i.test(value)) return true;
  // Seven digits is the shortest thing anyone dials. A name may carry a digit
  // or two ("Sam the 2nd"); it does not carry seven.
  return (value.match(/\d/g) ?? []).length >= 7;
}

export const personReferenceLabelSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Add a name for this person.")
      .max(
        PERSON_REFERENCE_LABEL_MAX_LENGTH,
        `Keep this under ${PERSON_REFERENCE_LABEL_MAX_LENGTH} characters.`,
      )
      .refine((value) => !looksLikeContactDetail(value), PERSON_REFERENCE_CONTACT_DETAIL_MESSAGE),
  );

export function normalizePersonReferenceLabel(value: unknown): string {
  return personReferenceLabelSchema.parse(value);
}

/**
 * A minimal, record-local name for an external person on a household-native
 * coordination record.
 *
 * There is no `personId`, and there never will be. A reference names someone an
 * authorized member typed onto this one record; it is not a contact, a profile,
 * an identity match, or a permission-bearing link into anyone's People graph.
 * Its visibility is the containing record's visibility, which is why it stores
 * no scope or audience of its own (ADR 0218).
 */
export const personReferenceSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  recordKind: personReferenceRecordKindSchema,
  recordId: z.string(),
  label: personReferenceLabelSchema,
  createdByUserId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PersonReference = z.infer<typeof personReferenceSchema>;
