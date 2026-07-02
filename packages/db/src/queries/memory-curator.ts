import {
  type Memory,
  type MemoryCuratorProposal,
  type MemoryCuratorProposalResult,
  memoryCuratorProposalResultSchema,
  type Sensitivity,
  type SourceRecord,
} from "@tendnote/domain";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../client";
import { memories, people, sourceRecords } from "../schema";

type CuratorMemory = Pick<
  Memory,
  | "id"
  | "ownerUserId"
  | "personId"
  | "sourceRecordId"
  | "content"
  | "status"
  | "sensitivity"
  | "confidence"
  | "importance"
  | "scope"
  | "updatedAt"
> & { personDisplayName: string | null };

type CuratorSourceRecord = Pick<
  SourceRecord,
  "id" | "ownerUserId" | "content" | "status" | "sensitivity" | "confidence" | "scope" | "updatedAt"
>;

export type MemoryCuratorInput = {
  ownerUserId: string;
  limit?: number;
  now?: Date;
};

export type MemoryCuratorContext = {
  ownerUserId: string;
  memories: CuratorMemory[];
  sourceRecords: CuratorSourceRecord[];
  now: Date;
  limit?: number;
};

export function buildMemoryCuratorProposals(
  input: MemoryCuratorContext,
): MemoryCuratorProposalResult {
  const proposals: MemoryCuratorProposal[] = [
    ...duplicateMemoryProposals(input),
    ...staleMemoryProposals(input),
    ...contradictionProposals(input),
    ...rewriteProposals(input),
    ...clarificationProposals(input),
    ...sourceRecordCleanupProposals(input),
  ].slice(0, input.limit ?? 20);

  return memoryCuratorProposalResultSchema.parse({
    ownerUserId: input.ownerUserId,
    proposals,
    component: {
      type: "memory_curator_proposals",
      proposalCount: proposals.length,
    },
  });
}

export async function getMemoryCuratorProposals(input: MemoryCuratorInput) {
  const ownerUserId = input.ownerUserId;
  const [memoryRows, sourceRows] = await Promise.all([
    getDb()
      .select({
        id: memories.id,
        ownerUserId: memories.ownerUserId,
        personId: memories.personId,
        sourceRecordId: memories.sourceRecordId,
        content: memories.content,
        status: memories.status,
        sensitivity: memories.sensitivity,
        confidence: memories.confidence,
        importance: memories.importance,
        scope: memories.scope,
        updatedAt: memories.updatedAt,
        personDisplayName: people.displayName,
      })
      .from(memories)
      .leftJoin(people, and(eq(people.id, memories.personId), eq(people.ownerUserId, ownerUserId)))
      .where(
        and(
          eq(memories.ownerUserId, ownerUserId),
          eq(memories.status, "approved"),
          ne(memories.sensitivity, "restricted"),
          eq(memories.scope, "private"),
        ),
      )
      .orderBy(desc(memories.importance), desc(memories.updatedAt))
      .limit(200),
    getDb()
      .select({
        id: sourceRecords.id,
        ownerUserId: sourceRecords.ownerUserId,
        content: sourceRecords.content,
        status: sourceRecords.status,
        sensitivity: sourceRecords.sensitivity,
        confidence: sourceRecords.confidence,
        scope: sourceRecords.scope,
        updatedAt: sourceRecords.updatedAt,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.ownerUserId, ownerUserId),
          eq(sourceRecords.status, "active"),
          ne(sourceRecords.sensitivity, "restricted"),
          eq(sourceRecords.scope, "private"),
        ),
      )
      .orderBy(desc(sourceRecords.updatedAt))
      .limit(200),
  ]);

  return buildMemoryCuratorProposals({
    ownerUserId,
    memories: memoryRows,
    sourceRecords: sourceRows,
    now: input.now ?? new Date(),
    limit: input.limit,
  });
}

function duplicateMemoryProposals(input: MemoryCuratorContext): MemoryCuratorProposal[] {
  const groups = new Map<string, CuratorMemory[]>();
  for (const memory of scopedMemories(input)) {
    const key = `${memory.personId}:${normalizeContent(memory.content)}`;
    groups.set(key, [...(groups.get(key) ?? []), memory]);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const first = group[0];
      if (!first) {
        throw new Error("Duplicate memory group unexpectedly empty.");
      }
      return proposal(input.ownerUserId, {
        kind: "duplicate_memory",
        personId: first.personId,
        personDisplayName: first.personDisplayName,
        title: `Possible duplicate memory for ${first.personDisplayName ?? "a person"}`,
        reason: "Two approved memories have the same normalized content.",
        suggestedAction:
          "Review both memories and decide whether one should be archived or rewritten.",
        sourceRefs: group.slice(0, 3).map((memory) => memoryRef(memory)),
        sensitivity: maxSensitivity(group.map((memory) => memory.sensitivity)),
      });
    });
}

function staleMemoryProposals(input: MemoryCuratorContext): MemoryCuratorProposal[] {
  const staleBefore = new Date(input.now.getTime() - 365 * 24 * 60 * 60 * 1000);
  return scopedMemories(input)
    .filter(
      (memory) =>
        memory.updatedAt.getTime() < staleBefore.getTime() &&
        (memory.confidence === "low" || memory.importance <= 2),
    )
    .map((memory) =>
      proposal(input.ownerUserId, {
        kind: "stale_memory_archive",
        personId: memory.personId,
        personDisplayName: memory.personDisplayName,
        title: `Possibly stale memory for ${memory.personDisplayName ?? "a person"}`,
        reason: "This low-confidence or low-importance memory has not changed in over a year.",
        suggestedAction:
          "Review whether this memory should be archived or rewritten with fresher context.",
        sourceRefs: [memoryRef(memory)],
        sensitivity: memory.sensitivity,
      }),
    );
}

function contradictionProposals(input: MemoryCuratorContext): MemoryCuratorProposal[] {
  const byPerson = new Map<string, CuratorMemory[]>();
  for (const memory of scopedMemories(input)) {
    byPerson.set(memory.personId, [...(byPerson.get(memory.personId) ?? []), memory]);
  }

  const proposals: MemoryCuratorProposal[] = [];
  for (const group of byPerson.values()) {
    const locations = group
      .map((memory) => ({ memory, location: locationClaim(memory.content) }))
      .filter(
        (item): item is { memory: CuratorMemory; location: string } => item.location !== null,
      );
    const distinct = new Set(locations.map((item) => item.location));
    if (distinct.size < 2) continue;

    proposals.push(
      proposal(input.ownerUserId, {
        kind: "contradiction_warning",
        personId: group[0]?.personId ?? null,
        personDisplayName: group[0]?.personDisplayName ?? null,
        title: `Possible conflicting location memories for ${group[0]?.personDisplayName ?? "a person"}`,
        reason: "Multiple approved memories appear to state different current locations.",
        suggestedAction:
          "Ask the owner which location is current before editing or archiving anything.",
        sourceRefs: locations.slice(0, 3).map((item) => memoryRef(item.memory)),
        sensitivity: maxSensitivity(locations.map((item) => item.memory.sensitivity)),
      }),
    );
  }
  return proposals;
}

function rewriteProposals(input: MemoryCuratorContext): MemoryCuratorProposal[] {
  return scopedMemories(input)
    .filter((memory) => /(?:stuff|things|misc|something|somewhere)/i.test(memory.content))
    .map((memory) =>
      proposal(input.ownerUserId, {
        kind: "rewrite_suggestion",
        personId: memory.personId,
        personDisplayName: memory.personDisplayName,
        title: `Vague memory for ${memory.personDisplayName ?? "a person"}`,
        reason: "The memory uses vague language that may be hard for Eve to use later.",
        suggestedAction: "Rewrite the memory into one concrete fact after owner review.",
        sourceRefs: [memoryRef(memory)],
        sensitivity: memory.sensitivity,
      }),
    );
}

function clarificationProposals(input: MemoryCuratorContext): MemoryCuratorProposal[] {
  return scopedMemories(input)
    .filter((memory) => /(?:maybe|not sure|might|possibly|unknown)/i.test(memory.content))
    .map((memory) =>
      proposal(input.ownerUserId, {
        kind: "clarification_prompt",
        personId: memory.personId,
        personDisplayName: memory.personDisplayName,
        title: `Clarification needed for ${memory.personDisplayName ?? "a person"}`,
        reason: "The memory is explicitly uncertain.",
        suggestedAction: "Ask the owner a clarifying question before changing the memory.",
        sourceRefs: [memoryRef(memory)],
        sensitivity: memory.sensitivity,
      }),
    );
}

function sourceRecordCleanupProposals(input: MemoryCuratorContext): MemoryCuratorProposal[] {
  const memorySourceIds = new Set(scopedMemories(input).map((memory) => memory.sourceRecordId));
  const staleBefore = new Date(input.now.getTime() - 180 * 24 * 60 * 60 * 1000);

  return input.sourceRecords
    .filter(
      (record) =>
        record.ownerUserId === input.ownerUserId &&
        record.scope === "private" &&
        record.updatedAt.getTime() < staleBefore.getTime() &&
        !memorySourceIds.has(record.id),
    )
    .map((record) =>
      proposal(input.ownerUserId, {
        kind: "source_record_cleanup",
        personId: null,
        personDisplayName: null,
        title: "Old Source Record with no approved memory",
        reason:
          "This active logged context is older than six months and has no approved memory linked.",
        suggestedAction:
          "Review whether it should stay as logged context, be summarized, or be archived.",
        sourceRefs: [sourceRecordRef(record)],
        sensitivity: record.sensitivity,
      }),
    );
}

function scopedMemories(input: MemoryCuratorContext) {
  return input.memories.filter(
    (memory) =>
      memory.ownerUserId === input.ownerUserId &&
      memory.status === "approved" &&
      memory.sensitivity !== "restricted" &&
      memory.scope === "private",
  );
}

function proposal(
  ownerUserId: string,
  input: Omit<MemoryCuratorProposal, "id" | "ownerUserId" | "reviewOnly">,
): MemoryCuratorProposal {
  return {
    id: `${input.kind}:${input.sourceRefs.map((ref) => ref.id).join(":")}`,
    ownerUserId,
    reviewOnly: true,
    ...input,
  };
}

function memoryRef(memory: CuratorMemory) {
  return { kind: "memory" as const, id: memory.id, label: memory.content };
}

function sourceRecordRef(record: CuratorSourceRecord) {
  return { kind: "source_record" as const, id: record.id, label: record.content };
}

function normalizeContent(content: string) {
  return content
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function locationClaim(content: string): string | null {
  const match = content.match(/\b(?:lives in|moved to|is in)\s+([A-Z][A-Za-z ]{2,30})/);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

function maxSensitivity(values: Sensitivity[]): Sensitivity {
  if (values.includes("restricted")) return "restricted";
  if (values.includes("sensitive")) return "sensitive";
  return "normal";
}
