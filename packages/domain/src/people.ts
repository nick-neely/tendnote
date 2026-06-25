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
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type ContactMethod = z.infer<typeof contactMethodSchema>;
export type ContactMethodType = z.infer<typeof contactMethodTypeSchema>;
export type SearchPeopleInput = z.input<typeof searchPeopleSchema>;
