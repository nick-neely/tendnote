import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import type { HouseholdAuditLogEntry } from "../households/types";
import type { RelationshipRecordFacts, RelationshipShareStore } from "./types";

/**
 * The executable substrate for the sharing suites: real share rows, real
 * membership rules, and relationship records seeded directly as facts.
 *
 * Seeding facts rather than rows keeps the leak-prevention matrix readable —
 * a test says "a restricted memory owned by Mara" instead of assembling three
 * tables — while the household half stays the same in-memory store the
 * authorization and governance suites already exercise.
 */
export function createInMemoryRelationshipShareStore(
  seed: {
    records?: readonly RelationshipRecordFacts[];
    /** Keyed `ownerUserId:personId`, mirroring the owner-scoped read. */
    personLabels?: Readonly<Record<string, string>>;
    memberNames?: Readonly<Record<string, string>>;
  } = {},
  /**
   * Injectable for the same reason as the Asset, General Action, Gift Plan, and
   * Person Reference stores: a cross-domain suite drives every family against
   * one membership and share registry, because two would let the domains
   * disagree about who is a member.
   */
  householdStore: ReturnType<typeof createInMemoryHouseholdStore> = createInMemoryHouseholdStore(),
): RelationshipShareStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<HouseholdAuditLogEntry[]>;
  readSeededRecord: (recordId: string) => RelationshipRecordFacts | undefined;
} {
  const household = householdStore;
  const records = new Map<string, RelationshipRecordFacts>(
    (seed.records ?? []).map((record) => [`${record.recordKind}:${record.recordId}`, record]),
  );
  const personLabels = new Map(Object.entries(seed.personLabels ?? {}));
  const memberNames = new Map(Object.entries(seed.memberNames ?? {}));

  return {
    ...household,
    async getRelationshipRecord(input) {
      return records.get(`${input.recordKind}:${input.recordId}`) ?? null;
    },
    async updateRelationshipRecordVisibility(input) {
      const key = `${input.recordKind}:${input.recordId}`;
      const record = records.get(key);
      // Owner-keyed like the real update: a non-owner's write finds nothing
      // rather than silently re-addressing someone else's record.
      if (!record || record.ownerUserId !== input.ownerUserId) return;
      records.set(key, { ...record, scope: input.scope, householdId: input.householdId });
    },
    async getPersonDisplayLabel(input) {
      return personLabels.get(`${input.ownerUserId}:${input.personId}`) ?? null;
    },
    async getMemberDisplayName(input) {
      return memberNames.get(input.userId) ?? null;
    },
    readSeededRecord(recordId) {
      return [...records.values()].find((record) => record.recordId === recordId);
    },
  };
}
