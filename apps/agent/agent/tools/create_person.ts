import { createPerson } from "@tendnote/db/queries/people";
import { relationshipTypeSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";

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
    "Add a new person to the user's notebook when the user explicitly asks to add or create someone outside Global Capture. Do not use this for 'Use Capture', 'capture this', or a turn with another supported explicit clause even if the word Capture is absent; capture_saved_item owns that path. Otherwise search existing people first; never call this for a casual or ambiguous mention — ask the user to disambiguate instead. Returns a persisted person reference.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await createPerson({
      ownerUserId,
      displayName: input.displayName,
      relationshipType: input.relationshipType,
      profileBlurb: input.profileBlurb,
    });
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const person = outcome.result;

    return {
      person: {
        id: person.id,
        displayName: person.displayName,
        relationshipType: person.relationshipType,
      },
      component: { type: "person_created", personId: person.id },
    };
  },
  // The new person is rendered as a card the user already sees. Keep the name (the
  // model needs it to refer to them) and the id (to chain a next action), but remind
  // the model to keep its confirmation to a brief line rather than restating details.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        added: true,
        personId: output.person.id,
        person: output.person.displayName,
        relationshipType: output.person.relationshipType,
        rendered: "The new person is shown to the user in a card.",
        guidance:
          "Keep your confirmation to a brief line — the card already shows who you added; don't restate their details at length.",
      },
    };
  },
});
