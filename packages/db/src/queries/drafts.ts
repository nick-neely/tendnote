import type { MessageDraftStatus } from "@tendnote/domain";
import { createDrizzleDraftStore } from "./drafts/drizzle-store";

export {
  createDrizzleDraftLifecycleStore,
  createDrizzleDraftStore,
} from "./drafts/drizzle-store";
export {
  createInMemoryDraftLifecycleStore,
  createInMemoryDraftStore,
} from "./drafts/in-memory-store";
export type * from "./drafts/types";

// Default owner-scoped draft reads (issue #76). Later slices add the shared
// generator (#77) and lifecycle actions (#78); render-time surfaces read drafts
// through these so they never fork draft storage.
const defaultDraftStore = createDrizzleDraftStore();

/** A single owner-scoped draft (with its persisted source references), or null. */
export function getDraft(input: { ownerUserId: string; draftId: string }) {
  return defaultDraftStore.getDraft(input);
}

/** The owner's drafts for a person, newest first, optionally filtered by status. */
export function listDraftsForPerson(input: {
  ownerUserId: string;
  personId: string;
  statuses?: MessageDraftStatus[];
}) {
  return defaultDraftStore.listDraftsForPerson(input);
}
