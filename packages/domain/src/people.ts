import { z } from "zod";
import { sourceSchema } from "./privacy";

export const relationshipTypeSchema = z.enum([
  "friend",
  "family",
  "partner",
  "colleague",
  "professional",
  "networking",
  "neighbor",
  "other",
]);

export const contactMethodTypeSchema = z.enum(["email", "phone", "social", "other"]);

export const personSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  displayName: z.string().min(1),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  relationshipType: relationshipTypeSchema.default("other"),
  closenessLevel: z.number().int().min(1).max(5).default(3),
  profileBlurb: z.string().max(280).nullable().optional(),
  source: sourceSchema.default("manual"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createPersonSchema = personSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({
    ownerUserId: true,
    relationshipType: true,
    closenessLevel: true,
    source: true,
  })
  .extend({
    displayName: z.string().min(1),
  });

/**
 * Editable person profile fields. Every field is optional — only the keys the
 * caller provides are changed — and at least one must be present. `null` clears a
 * nullable field; `undefined` (omitted) leaves it untouched. Identity, ownership,
 * provenance (`source`), and timestamps are not editable here. This is for profile
 * attributes (name, birthday, relationship), not memories — facts about a person go
 * through `capture_memory`.
 */
export const updatePersonSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    firstName: z.string().trim().max(120).nullable().optional(),
    lastName: z.string().trim().max(120).nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthday must be an ISO date (YYYY-MM-DD).")
      .nullable()
      .optional(),
    relationshipType: relationshipTypeSchema.optional(),
    closenessLevel: z.number().int().min(1).max(5).optional(),
    profileBlurb: z.string().trim().max(280).nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Provide at least one field to update.",
  });

export const contactMethodSchema = z.object({
  id: z.string(),
  personId: z.string(),
  type: contactMethodTypeSchema,
  value: z.string().min(1),
  isPrimary: z.boolean().default(false),
  source: z.string().default("manual"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const searchPeopleSchema = z.object({
  query: z.string().trim().optional(),
  relationshipType: relationshipTypeSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export function requiresPersonDisambiguation(candidates: Pick<Person, "id">[]) {
  return candidates.length > 1;
}

export type Person = z.infer<typeof personSchema>;
export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type ContactMethod = z.infer<typeof contactMethodSchema>;
export type ContactMethodType = z.infer<typeof contactMethodTypeSchema>;
export type SearchPeopleInput = z.input<typeof searchPeopleSchema>;
