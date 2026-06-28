import { updatePerson } from "@tendnote/db/queries/people";
import { relationshipTypeSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z
  .object({
    personId: z
      .uuid()
      .describe(
        "The resolved person to update. Resolve identity with search_people first; never guess.",
      ),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("New display name, when the user wants to rename the person."),
    firstName: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .describe("First name; pass null to clear it."),
    lastName: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .describe("Last name; pass null to clear it."),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthday must be an ISO date (YYYY-MM-DD).")
      .nullable()
      .optional()
      .describe(
        "Birthday as an ISO date (YYYY-MM-DD); pass null to clear it. Resolve any relative or partial phrasing to a concrete date against today's date first.",
      ),
    relationshipType: relationshipTypeSchema
      .optional()
      .describe("How the user knows this person, when they restate or correct it."),
    closenessLevel: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        "How close the relationship is — 1 (distant) to 5 (closest) — when the user says so.",
      ),
    profileBlurb: z
      .string()
      .trim()
      .max(280)
      .nullable()
      .optional()
      .describe("A short one-line description; pass null to clear it."),
  })
  .refine(
    (input) =>
      Object.entries(input).some(([key, value]) => key !== "personId" && value !== undefined),
    { message: "Provide at least one field to update besides personId." },
  );

/**
 * Edits an existing person's profile attributes (name, birthday, relationship,
 * closeness, blurb) through the shared owner-scoped `updatePerson` mutation so web
 * and agent stay consistent (ADR 0001). This is NOT for memories or logged context
 * — facts about a person go through `capture_memory`, and casual notes through
 * `capture_source_record`. Only the provided fields change.
 */
export default defineTool({
  description:
    "Update an existing person's profile fields — display name, first/last name, birthday, relationship type, closeness, or one-line blurb — when the user asks to change those details ('change Mara's birthday to March 3', 'rename Sam to Samuel', 'mark Theo as a colleague'). Resolve the person with search_people first; pass only the fields that change. This edits profile attributes, NOT memories — use capture_memory for facts about a person and capture_source_record for logged context. Returns the updated person reference.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const { personId, ...patch } = input;

    const person = await updatePerson({ ownerUserId, personId, ...patch });

    if (!person) {
      return {
        updated: false,
        component: { type: "person_update_failed", personId },
      };
    }

    return {
      updated: true,
      person: {
        id: person.id,
        displayName: person.displayName,
        relationshipType: person.relationshipType,
      },
      updatedFields: Object.keys(patch).filter(
        (key) => patch[key as keyof typeof patch] !== undefined,
      ),
      component: { type: "person_updated", personId: person.id },
    };
  },
  // The updated profile is rendered as a card the user already sees. Keep the name,
  // id, and which fields changed so the model can confirm naturally, but remind it
  // not to restate the full profile; the channel still renders the full output.
  toModelOutput(output) {
    if (!output.updated || !output.person) {
      return {
        type: "json" as const,
        value: {
          updated: false,
          guidance:
            "The update didn't apply (the person couldn't be found). Tell the user and offer to confirm who they meant.",
        },
      };
    }
    return {
      type: "json" as const,
      value: {
        updated: true,
        personId: output.person.id,
        person: output.person.displayName,
        updatedFields: output.updatedFields,
        rendered: "The updated profile is shown to the user in a card.",
        guidance:
          "Confirm briefly which fields you changed — the card shows the result; don't restate the full profile.",
      },
    };
  },
});
