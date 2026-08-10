import { createDrizzleRelationshipShareStore } from "./relationship-shares/drizzle-store";
import { createRelationshipSharing } from "./relationship-shares/sharing";

export { createDrizzleRelationshipShareStore } from "./relationship-shares/drizzle-store";
export { createInMemoryRelationshipShareStore } from "./relationship-shares/in-memory-store";
export { createRelationshipSharing } from "./relationship-shares/sharing";
export type {
  RelationshipRecordFacts,
  RelationshipShareState,
  RelationshipShareStore,
  ShareRelationshipRecordInput,
} from "./relationship-shares/types";

/**
 * Built once, lazily: the sharing seam composes the household store, which is
 * also what the authorization prover reads from, and a module-scope instance
 * would make that load order matter.
 */
let sharing: ReturnType<typeof createRelationshipSharing> | null = null;

function relationshipSharing() {
  sharing ??= createRelationshipSharing(createDrizzleRelationshipShareStore());
  return sharing;
}

/** Sets who may read one relationship record. Owner-only, proof-enforced. */
export const shareRelationshipRecord: ReturnType<
  typeof createRelationshipSharing
>["shareRelationshipRecord"] = (input) => relationshipSharing().shareRelationshipRecord(input);

/** Returns one relationship record to private and clears its shares. */
export const stopSharingRelationshipRecord: ReturnType<
  typeof createRelationshipSharing
>["stopSharingRelationshipRecord"] = (input) =>
  relationshipSharing().stopSharingRelationshipRecord(input);

/** The owner's current audience for one record. */
export const getRelationshipShareState: ReturnType<
  typeof createRelationshipSharing
>["getRelationshipShareState"] = (input) => relationshipSharing().getRelationshipShareState(input);

/** The owner's audiences for many records of one kind, in one read. */
export const listRelationshipShareAudiences: ReturnType<
  typeof createRelationshipSharing
>["listRelationshipShareAudiences"] = (input) =>
  relationshipSharing().listRelationshipShareAudiences(input);

/** One shared record as its audience may see it, or null for every refusal. */
export const readSharedRelationshipRecord: ReturnType<
  typeof createRelationshipSharing
>["readSharedRelationshipRecord"] = (input) =>
  relationshipSharing().readSharedRelationshipRecord(input);
