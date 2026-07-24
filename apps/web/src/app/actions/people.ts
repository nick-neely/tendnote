"use server";

import { deletePerson, getPersonProfile } from "@tendnote/db/queries/people";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  peopleMutationScopes,
  updatePeopleMutationScopes,
} from "@/lib/cache/people-mutation-scopes";

const deletePersonActionSchema = z.object({ personId: z.uuid() });

export type PersonRemovalPreview = {
  memories: Array<{ id: string; text: string }>;
  followups: Array<{ id: string; text: string }>;
  drafts: Array<{ id: string; text: string }>;
};

/** Loaded only after the owner opens the destructive confirmation dialog. */
export async function getPersonRemovalPreviewAction(input: {
  personId: string;
}): Promise<PersonRemovalPreview> {
  const { personId } = deletePersonActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const profile = await getPersonProfile({ ownerUserId, personId });

  if (!profile) throw new Error("That person is no longer available.");

  return {
    memories: profile.memories.map((memory) => ({ id: memory.id, text: memory.content })),
    followups: profile.followups.map((followup) => ({ id: followup.id, text: followup.reason })),
    drafts: [],
  };
}

/**
 * Permanently remove a person and everything owned by them (memories, follow-ups,
 * drafts, snapshots, contact methods) via the shared owner-scoped mutation. This is
 * a deliberate, human-only action — it is intentionally not exposed as an Eve tool.
 * The person's profile is gone after this, so the caller navigates away rather than
 * refreshing; the People list is revalidated so the removed person drops out of it.
 */
export async function deletePersonAction(input: { personId: string }): Promise<{
  affectedScopes: ReturnType<typeof peopleMutationScopes.forPerson>;
  revision: string;
}> {
  const parsed = deletePersonActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();

  const removed = await deletePerson({ ownerUserId, personId: parsed.personId });
  const affectedScopes = peopleMutationScopes.forPerson({
    ownerUserId,
    personId: parsed.personId,
  });
  updatePeopleMutationScopes(affectedScopes);

  return {
    affectedScopes,
    revision: removed?.updatedAt.toISOString() ?? `missing:${parsed.personId}`,
  };
}
