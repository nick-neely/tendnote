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

/**
 * The people-search match rule: the single source of truth for who an Exact
 * people lookup returns. A person matches when the case-insensitive query is a
 * substring of their display name, first name, or last name, and — when a
 * relationship-type filter is given — their relationship type equals it. The
 * Postgres adapter mirrors this with `ilike '%query%'` over the same three fields;
 * the in-memory adapter applies it directly, so tests over the double validate the
 * fields production actually searches.
 */
export function personMatchesPeopleSearch(
  person: Pick<Person, "displayName" | "firstName" | "lastName" | "relationshipType">,
  filter: { query?: string; relationshipType?: RelationshipType },
): boolean {
  if (filter.relationshipType && person.relationshipType !== filter.relationshipType) {
    return false;
  }

  const query = filter.query?.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [person.displayName, person.firstName, person.lastName].some((field) =>
    field?.toLowerCase().includes(query),
  );
}

/**
 * Stable people-search ordering: by display name, then id for a deterministic
 * tie-break. The Postgres adapter mirrors this with `order by display_name, id`.
 * Display-name case/locale ordering follows the database collation there and
 * `localeCompare` here, so the two agree for same-case ASCII names and may differ
 * only by collation case/locale rules. The id tie-break is a code-point compare,
 * which matches Postgres's `uuid`-column byte ordering exactly (ids are canonical
 * UUIDs), so equal display names always break the same way across adapters.
 */
export function comparePeopleForSearch(
  left: Pick<Person, "id" | "displayName">,
  right: Pick<Person, "id" | "displayName">,
): number {
  const byDisplayName = left.displayName.localeCompare(right.displayName);
  if (byDisplayName !== 0) {
    return byDisplayName;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export type Person = z.infer<typeof personSchema>;
export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type ContactMethod = z.infer<typeof contactMethodSchema>;
export type ContactMethodType = z.infer<typeof contactMethodTypeSchema>;
export type SearchPeopleInput = z.input<typeof searchPeopleSchema>;
