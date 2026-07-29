import type { CreateSourceRecordInput, Memory } from "@tendnote/domain";
import { createFollowupLifecycle } from "../followups/lifecycle";
import { createHouseholdLifecycle } from "../households/lifecycle";
import { createInMemoryRelationshipAgendaStore } from "./in-memory-store";
import { createRelationshipAgenda } from "./query";

export const OWNER = "user-1";
export const OTHER_OWNER = "user-2";
export const WINDOW_START = new Date("2026-07-01T00:00:00Z");
export const WINDOW_END = new Date("2026-07-07T23:59:59Z");

/**
 * Shared fixture for the relationship-agenda read-model tests: an in-memory store
 * wired to the follow-up lifecycle and the agenda query, plus a `person` factory.
 * The agenda suite is split by theme (foundation, review candidates, recent
 * context, semantic context) across sibling `query.*.test.ts` files; they all
 * build on this one setup so the test data shape stays consistent.
 */
export async function setup() {
  const store = createInMemoryRelationshipAgendaStore();
  const followups = createFollowupLifecycle(store);
  const agenda = createRelationshipAgenda(store);

  async function person(displayName: string, birthday: string | null, ownerUserId = OWNER) {
    return store.createPerson({
      ownerUserId,
      displayName,
      firstName: null,
      lastName: null,
      birthday,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  /**
   * A captured note as the agenda usually meets one: the owner's own private,
   * active, normal-sensitivity manual note. Cases name only the field they turn on
   * - `status: "pending_resolution"` for something awaiting review, `scope:
   * "shared"` for household visibility - so the line that differs from the default
   * is the thing under test.
   */
  async function sourceRecord(
    overrides: Partial<CreateSourceRecordInput> & Pick<CreateSourceRecordInput, "content">,
  ) {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
      ...overrides,
    });
  }

  return { store, followups, agenda, person, sourceRecord };
}

/**
 * `setup()` with a household `memberUserId` has already accepted, for the reads
 * that must answer a household member rather than the owner.
 *
 * Membership on its own grants nothing: each test still shares the specific
 * records it expects the member to see, which is what makes the "and does not
 * leak the private one" half of every visibility case meaningful.
 */
export async function setupWithHouseholdMember() {
  const base = await setup();
  const households = createHouseholdLifecycle(base.store);
  const memberUserId = "user-3";
  const { household } = await households.createHousehold({ ownerUserId: OWNER, name: "Home" });

  await households.inviteMember({
    ownerUserId: OWNER,
    householdId: household.id,
    invitedUserId: memberUserId,
  });
  await households.acceptInvite({ householdId: household.id, userId: memberUserId });

  return { ...base, household, memberUserId };
}

export function suggestedMemory(
  overrides: Partial<Memory> & Pick<Memory, "personId" | "sourceRecordId" | "content">,
): Memory {
  const now = new Date("2026-06-01T00:00:00Z");

  return {
    id: overrides.id ?? `memory-${Math.random()}`,
    ownerUserId: overrides.ownerUserId ?? OWNER,
    personId: overrides.personId,
    sourceRecordId: overrides.sourceRecordId,
    content: overrides.content,
    memoryType: overrides.memoryType ?? "context",
    status: overrides.status ?? "suggested",
    importance: overrides.importance ?? 3,
    sensitivity: overrides.sensitivity ?? "normal",
    confidence: overrides.confidence ?? "medium",
    scope: overrides.scope ?? "private",
    householdId: overrides.householdId ?? null,
    approvedAt: overrides.approvedAt ?? null,
    dismissedAt: overrides.dismissedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}
