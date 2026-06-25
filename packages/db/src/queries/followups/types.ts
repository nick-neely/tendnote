import type { CreateFollowupInput, Followup } from "@tendnote/domain";

/**
 * Read-only follow-up surface the snapshot read path depends on. It returns the
 * owner's follow-ups for a person; the snapshot builder selects the eligible ones
 * (active or recently completed) via domain policy. The read seam is intentionally
 * read-only — follow-up lifecycle stays owned by follow-up records, not the
 * snapshot cache (ADR 0009, PRD #11).
 */
export type FollowupContextStore = {
  listFollowupsForPerson: (input: { ownerUserId: string; personId: string }) => Promise<Followup[]>;
};

/**
 * Full follow-up store: the read surface plus follow-up creation. The bundled
 * stores implement this; only `listFollowupsForPerson` is exposed to the snapshot
 * read path.
 */
export type FollowupStore = FollowupContextStore & {
  createFollowup: (input: CreateFollowupInput) => Promise<Followup>;
};
