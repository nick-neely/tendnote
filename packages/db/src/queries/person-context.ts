import {
  canUseMemoryProactively,
  canUseSensitiveContext,
  canUseSourceRecordProactively,
  type Memory,
  type Person,
  type SourceRecord,
} from "@tendnote/domain";
import { createDrizzleMemoryStore } from "./memories/drizzle-store";
import type { MemoryReviewStore } from "./memories/types";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";
import type { SourceRecordResolutionStore } from "./source-records/types";

/**
 * Store surface for trust-aware person context: approved memories, suggested
 * memories, and the active source records linked to a person. All reads are
 * owner-scoped.
 */
export type PersonContextStore = MemoryReviewStore &
  Pick<SourceRecordResolutionStore, "listSourceRecordsForPersonContext">;

export type GetPersonContextInput = {
  ownerUserId: string;
  personId: string;
  // Set when the user directly asked about this person/topic, which relaxes the
  // proactive restriction on restricted-sensitivity content (ADR 0058).
  directlyRequested?: boolean;
};

export type PersonContextResult = {
  person: Person | null;
  // Approved memories — durable, confirmed facts (ADR 0004).
  approvedMemories: Memory[];
  // Source records — source-grounded logged context ("you noted/mentioned").
  sourceRecords: SourceRecord[];
  // Suggested memories — tentative review items, never stated as fact.
  suggestedMemories: Memory[];
};

const EMPTY_CONTEXT: Omit<PersonContextResult, "person"> = {
  approvedMemories: [],
  sourceRecords: [],
  suggestedMemories: [],
};

/**
 * Phase 1A trust-aware person context (ADR 0004, ADR 0015). One shared
 * owner-scoped retrieval that the web profile and the Eve agent both call, so
 * relationship context is presented and phrased consistently:
 *
 * - approved memories are confirmed facts;
 * - active source records are logged context (dismissed/archived/pending are
 *   excluded; unresolved mentions never feed context);
 * - suggested memories are tentative review items.
 *
 * Restricted content stays out of proactive context unless `directlyRequested`
 * (ADR 0058). Importance/closeness travel as plain data, never as required
 * controls (ADR 0010, ADR 0048).
 */
export function createPersonContext(store: PersonContextStore) {
  return {
    async getPersonContext(input: GetPersonContextInput): Promise<PersonContextResult> {
      const person = await store.getPerson(input);

      if (!person) {
        return { person: null, ...EMPTY_CONTEXT };
      }

      const directlyRequested = input.directlyRequested ?? false;
      const [approved, suggested, sources] = await Promise.all([
        store.listApprovedMemoriesForPerson(input),
        store.listSuggestedMemoriesForOwner({
          ownerUserId: input.ownerUserId,
          personId: input.personId,
        }),
        store.listSourceRecordsForPersonContext(input),
      ]);

      return {
        person,
        approvedMemories: approved.filter((memory) =>
          canUseMemoryProactively(memory, { directlyRequested }),
        ),
        sourceRecords: sources.filter((sourceRecord) =>
          canUseSourceRecordProactively(sourceRecord, { directlyRequested }),
        ),
        // Suggested memories are review items rather than facts, but restricted
        // ones still stay out of proactive context unless directly requested.
        suggestedMemories: suggested.filter((memory) =>
          canUseSensitiveContext({ sensitivity: memory.sensitivity, directlyRequested }),
        ),
      };
    },
  };
}

const defaultPersonContextStore = {
  ...createDrizzleMemoryStore(),
  listSourceRecordsForPersonContext:
    createDrizzleSourceRecordStore().listSourceRecordsForPersonContext,
} satisfies PersonContextStore;

const defaultPersonContext = createPersonContext(defaultPersonContextStore);

export async function getPersonContext(input: GetPersonContextInput) {
  return defaultPersonContext.getPersonContext(input);
}
