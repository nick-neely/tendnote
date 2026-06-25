import { createPerson } from "@tendnote/db";
import { relationshipTypeSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("The name to file the new person under. Required."),
  relationshipType: relationshipTypeSchema
    .optional()
    .describe("How the user knows this person, when they say so."),
  profileBlurb: z
    .string()
    .trim()
    .max(280)
    .optional()
    .describe("A short one-line description, only when the user gives one."),
});

/**
 * Creates a person ONLY when the user explicitly intends to add one ("add",
 * "create", "I met …, add them"). Search first; a casual or ambiguous mention is
 * never a reason to create a person — ask the user to disambiguate instead
 * (ADR 0032, ADR 0033). Person creation goes through the shared owner-scoped
 * `createPerson` mutation so web and agent stay consistent (ADR 0001).
 */
export default defineTool({
  description:
    "Add a new person to the user's notebook when the user explicitly asks to add or create someone. Search existing people first; never call this for a casual or ambiguous mention — ask the user to disambiguate instead. Returns a persisted person reference.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const person = await createPerson({
      ownerUserId,
      displayName: input.displayName,
      relationshipType: input.relationshipType,
      profileBlurb: input.profileBlurb,
    });

    return {
      person: {
        id: person.id,
        displayName: person.displayName,
        relationshipType: person.relationshipType,
      },
      component: { type: "person_created", personId: person.id },
    };
  },
});
