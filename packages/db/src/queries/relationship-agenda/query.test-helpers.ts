import type { Memory } from "@tendnote/domain";
import { createFollowupLifecycle } from "../followups/lifecycle";
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

  return { store, followups, agenda, person };
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
    approvedAt: overrides.approvedAt ?? null,
    dismissedAt: overrides.dismissedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}
