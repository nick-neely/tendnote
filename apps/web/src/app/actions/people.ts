"use server";

import { deletePerson } from "@tendnote/db/queries/people";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

const deletePersonActionSchema = z.object({ personId: z.uuid() });

/**
 * Permanently remove a person and everything owned by them (memories, follow-ups,
 * drafts, snapshots, contact methods) via the shared owner-scoped mutation. This is
 * a deliberate, human-only action — it is intentionally not exposed as an Eve tool.
 * The person's profile is gone after this, so the caller navigates away rather than
 * refreshing; the People list is revalidated so the removed person drops out of it.
 */
export async function deletePersonAction(input: { personId: string }): Promise<void> {
  const parsed = deletePersonActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();

  await deletePerson({ ownerUserId, personId: parsed.personId });

  revalidatePath("/people");
}
