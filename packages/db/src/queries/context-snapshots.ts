import type { GetPersonContextSnapshotInput } from "./context-snapshots/builder";
import { createPersonContextSnapshot } from "./context-snapshots/builder";
import { createDrizzleContextSnapshotStore } from "./context-snapshots/drizzle-store";
import type { PersonContextSnapshotStore } from "./context-snapshots/types";
import { createDrizzleMemoryStore } from "./memories/drizzle-store";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";

export type {
  CreatePersonContextSnapshotOptions,
  GetPersonContextSnapshotInput,
  PersonContextSnapshotResult,
  SnapshotGenerator,
  SnapshotReadStatus,
} from "./context-snapshots/builder";
export { createPersonContextSnapshot } from "./context-snapshots/builder";
export { createDrizzleContextSnapshotStore } from "./context-snapshots/drizzle-store";
export { createInMemoryContextSnapshotStore } from "./context-snapshots/in-memory-store";
export type {
  LlmSnapshotGeneratorOptions,
  SnapshotProseModel,
} from "./context-snapshots/llm-generator";
export { createLlmSnapshotGenerator } from "./context-snapshots/llm-generator";
export type * from "./context-snapshots/types";

const defaultPersonContextSnapshotStore = {
  ...createDrizzleMemoryStore(),
  listSourceRecordsForPersonContext:
    createDrizzleSourceRecordStore().listSourceRecordsForPersonContext,
  ...createDrizzleContextSnapshotStore(),
} satisfies PersonContextSnapshotStore;

const defaultPersonContextSnapshot = createPersonContextSnapshot(defaultPersonContextSnapshotStore);

export async function getPersonContextSnapshot(input: GetPersonContextSnapshotInput) {
  return defaultPersonContextSnapshot.getPersonContextSnapshot(input);
}
