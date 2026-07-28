"use server";

import { deletePerson, getPersonProfile } from "@tendnote/db/queries/people";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

const deletePersonActionSchema = z.object({ personId: z.uuid() });

type PersonRemovalPreview = {
  memories: Array<{ id: string; text: string }>;
  followups: Array<{ id: string; text: string }>;
  drafts: Array<{ id: string; text: string }>;
};

/** Loaded only after the owner opens the destructive confirmation dialog. */
export async function getPersonRemovalPreviewAction(input: { personId: string }) {
  return runOwnerAction({
    schema: deletePersonActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      getPersonProfile({ ownerUserId, personId: parsed.personId }),
    result: (profile) => {
      if (!profile) throw new Error("That person is no longer available.");
      return {
        memories: profile.memories.map((memory) => ({ id: memory.id, text: memory.content })),
        followups: profile.followups.map((followup) => ({
          id: followup.id,
          text: followup.reason,
        })),
        drafts: [],
      } satisfies PersonRemovalPreview;
    },
  });
}

/**
 * Permanently remove a person and everything owned by them (memories, follow-ups,
 * drafts, snapshots, contact methods) via the shared owner-scoped mutation. This is
 * a deliberate, human-only action — it is intentionally not exposed as an Eve tool.
 * The person's profile is gone after this, so the caller navigates away rather than
 * refreshing; the People list is revalidated so the removed person drops out of it.
 */
export async function deletePersonAction(input: { personId: string }) {
  return runOwnerAction({
    schema: deletePersonActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      deletePerson({ ownerUserId, personId: parsed.personId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      revision: outcome.result?.updatedAt.toISOString() ?? `missing:${input.personId}`,
    }),
  });
}
