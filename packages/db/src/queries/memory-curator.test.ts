import type { Memory, SourceRecord } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { buildMemoryCuratorProposals } from "./memory-curator";

const now = new Date("2026-07-02T00:00:00.000Z");
const old = new Date("2024-01-01T00:00:00.000Z");
const recent = new Date("2026-06-01T00:00:00.000Z");

function memory(overrides: Partial<Memory> & { id: string; content: string }): Memory & {
  personDisplayName: string | null;
} {
  return {
    id: overrides.id,
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    personId: overrides.personId ?? "person-1",
    sourceRecordId: overrides.sourceRecordId ?? `source-${overrides.id}`,
    memoryType: overrides.memoryType ?? "context",
    content: overrides.content,
    status: overrides.status ?? "approved",
    importance: overrides.importance ?? 3,
    sensitivity: overrides.sensitivity ?? "normal",
    confidence: overrides.confidence ?? "medium",
    scope: overrides.scope ?? "private",
    approvedAt: overrides.approvedAt ?? recent,
    dismissedAt: overrides.dismissedAt ?? null,
    createdAt: overrides.createdAt ?? recent,
    updatedAt: overrides.updatedAt ?? recent,
    personDisplayName: overrides.personId === null ? null : "Maya",
  };
}

function sourceRecord(
  overrides: Partial<SourceRecord> & { id: string; content: string },
): SourceRecord {
  return {
    id: overrides.id,
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    sourceType: overrides.sourceType ?? "agent",
    content: overrides.content,
    rawContent: overrides.rawContent ?? null,
    retentionPolicy: overrides.retentionPolicy ?? "retain",
    status: overrides.status ?? "active",
    confidence: overrides.confidence ?? "medium",
    sensitivity: overrides.sensitivity ?? "normal",
    scope: overrides.scope ?? "private",
    importance: overrides.importance ?? 3,
    metadataJson: overrides.metadataJson ?? {},
    createdAt: overrides.createdAt ?? old,
    updatedAt: overrides.updatedAt ?? old,
  };
}

describe("Memory Curator proposal builder", () => {
  it("returns review-only grounded cleanup proposals for eligible private context", () => {
    const result = buildMemoryCuratorProposals({
      ownerUserId: "owner-1",
      now,
      memories: [
        memory({ id: "memory-1", content: "Maya lives in Austin." }),
        memory({ id: "memory-2", content: "Maya lives in Austin." }),
        memory({
          id: "memory-3",
          content: "Maya likes some stuff.",
          confidence: "low",
          importance: 1,
          updatedAt: old,
        }),
        memory({ id: "memory-4", content: "Maya maybe moved teams." }),
        memory({ id: "memory-5", content: "Maya moved to Denver." }),
      ],
      sourceRecords: [sourceRecord({ id: "source-old", content: "Old unpromoted note." })],
    });

    expect(result.component).toEqual({ type: "memory_curator_proposals", proposalCount: 6 });
    expect(result.proposals.map((proposal) => proposal.kind)).toEqual(
      expect.arrayContaining([
        "duplicate_memory",
        "stale_memory_archive",
        "contradiction_warning",
        "rewrite_suggestion",
        "clarification_prompt",
        "source_record_cleanup",
      ]),
    );
    for (const proposal of result.proposals) {
      expect(proposal.reviewOnly).toBe(true);
      expect(proposal.sourceRefs.length).toBeGreaterThan(0);
      expect(proposal.suggestedAction).toMatch(/Review|Ask|Rewrite/i);
    }
  });

  it("stays owner-scoped and excludes restricted or non-private context", () => {
    const result = buildMemoryCuratorProposals({
      ownerUserId: "owner-1",
      now,
      memories: [
        memory({ id: "memory-1", content: "Maya lives in Austin." }),
        memory({ id: "memory-2", content: "Maya lives in Austin.", ownerUserId: "owner-2" }),
        memory({
          id: "memory-3",
          content: "Maya lives in Austin.",
          sensitivity: "restricted",
        }),
        memory({
          id: "memory-4",
          content: "Maya lives in Austin.",
          scope: "shared",
        }),
      ],
      sourceRecords: [
        sourceRecord({ id: "source-1", content: "Owner one note." }),
        sourceRecord({ id: "source-2", content: "Other owner note.", ownerUserId: "owner-2" }),
        sourceRecord({ id: "source-3", content: "Shared note.", scope: "shared" }),
      ],
    });

    const sourceRefIds = result.proposals.flatMap((proposal) =>
      proposal.sourceRefs.map((ref) => ref.id),
    );
    expect(sourceRefIds).not.toContain("memory-2");
    expect(sourceRefIds).not.toContain("memory-3");
    expect(sourceRefIds).not.toContain("memory-4");
    expect(sourceRefIds).not.toContain("source-2");
    expect(sourceRefIds).not.toContain("source-3");
  });

  it("does not expose direct durable memory mutation actions", () => {
    const result = buildMemoryCuratorProposals({
      ownerUserId: "owner-1",
      now,
      memories: [memory({ id: "memory-1", content: "Maya likes some stuff." })],
      sourceRecords: [],
    });

    expect(JSON.stringify(result)).not.toMatch(
      /approve_suggested_memory|dismiss_suggested_memory|updateMemory|archiveMemory|deleteMemory|mergeMemory/i,
    );
  });
});
