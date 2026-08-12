import { type ContextFact, contextFactSchema } from "@tendnote/domain";

const OWNER = "user-owner";

const directProvenance = {
  channel: "account" as const,
  origin: "direct" as const,
  sourceRecordId: null,
};

type WritableContextFactFixture = ContextFact & {
  creatorUserId: string;
  lastActorUserId: string;
};

export function contextFactFixture(
  overrides: Partial<ContextFact> = {},
): WritableContextFactFixture {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const fact = contextFactSchema.parse({
    id: "fact-fixture",
    subject: { kind: "self", userId: OWNER },
    category: "background",
    content: "I prefer concise answers.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: directProvenance,
    suggestionEvidence: null,
    creatorUserId: OWNER,
    lastActorUserId: OWNER,
    reviewedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  if (fact.creatorUserId === null || fact.lastActorUserId === null) {
    throw new Error("A writable Context Fact fixture needs live actor ids.");
  }
  return fact as WritableContextFactFixture;
}
