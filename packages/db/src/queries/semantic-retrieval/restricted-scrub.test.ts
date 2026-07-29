import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectSourceRecordEmbeddedText } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createCountingAdapter, createHarness, EMBEDDING_CONFIG, OWNER } from "./harness";
import { fingerprintEmbeddedText } from "./processor";
import { createSemanticRetrievalQueries } from "./queries";
import type { EmbeddingAdapter, ProcessEmbeddingJobResult } from "./types";

/**
 * Restricting a record scrubs its embedded representation.
 *
 * The embed decision has always refused to send restricted text to a provider, which is
 * right for text that is restricted *before* it is embedded and does nothing for text that
 * was embedded first. A record edited to `restricted` afterwards left its row behind
 * carrying the full pre-restriction `embedded_text` and the vector derived from it, held
 * back only by the search seam's `e.sensitivity = <record>.sensitivity` equality. That
 * equality is a good gate and a bad resting place: it withholds the text on every query
 * path that remembers to ask, and one that forgets serves it.
 *
 * So the skip deletes the row. The equality stays as the belt to this braces - it is what
 * fails closed across the window between the edit and the job - but the durable property
 * these tests pin is the stronger one: after the job runs, there is nothing left to
 * withhold.
 */

/** A fixed unit vector, so a query embedded the same way scores an exact match. */
const vectorAdapter: EmbeddingAdapter = {
  async embedText(input) {
    return { vector: [1, 0, 0, 0], model: input.model, version: input.version };
  },
};

/** A row left over from a superseded embedding model, holding the same text. */
const SUPERSEDED_CONFIG = { model: "superseded-model", version: "v0" };

/**
 * What "scrubbed" has to mean, asserted as one indivisible claim: the job refused the
 * record *for secrecy*, the index holds nothing for it any more, and the deletion is on the
 * audit trail. Each of the three alone is satisfiable by a wrong implementation - a skip
 * that leaves the row, a delete for the wrong reason, a silent delete - so the cases below
 * always assert all three together.
 */
async function expectScrubbed(
  result: ProcessEmbeddingJobResult,
  harness: Pick<ReturnType<typeof createHarness>, "store" | "auditActions">,
) {
  expect(result).toEqual(
    expect.objectContaining({ outcome: "skipped", reason: "restricted_content" }),
  );
  await expect(harness.store.listRelationshipContextEmbeddings()).resolves.toEqual([]);
  await expect(harness.auditActions()).resolves.toContain("embedding_job.restricted_scrubbed");
}

describe("restricted records are scrubbed from the embedding index", () => {
  it("deletes every embedding row for a memory edited to restricted", async () => {
    const harness = createHarness({ adapter: vectorAdapter });
    const { store, createApprovedMemory, embedMemory } = harness;
    const memory = await createApprovedMemory();
    await embedMemory(memory.id);
    // A row under a retired model carries the same text as the active one, so the scrub
    // has to sweep the whole record, not just the pair the current config names.
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: memory.personId,
      recordKind: "memory",
      recordId: memory.id,
      embedding: [1, 0, 0, 0],
      embeddingModel: SUPERSEDED_CONFIG.model,
      embeddingVersion: SUPERSEDED_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: memory.content,
      contentFingerprint: fingerprintEmbeddedText({
        recordKind: "memory",
        recordId: memory.id,
        embeddedText: memory.content,
      }),
      trustLevel: "confirmed_fact",
      sensitivity: "normal",
      sourceUpdatedAt: memory.updatedAt,
    });
    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(2);

    const restricted = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { sensitivity: "restricted" },
    });

    const result = await embedMemory(restricted.id);

    await expectScrubbed(result, harness);
  });

  it("deletes the embedding row of a source record that is restricted after embedding", async () => {
    const harness = createHarness({ adapter: vectorAdapter });
    const { store, createPerson, createSourceRecord, linkSourceRecord, embedSourceRecord } =
      harness;
    const mara = await createPerson("Mara Lin");
    // The store has no sensitivity edit for source records, so the post-edit state is
    // planted directly: a restricted record whose row still holds the text it was embedded
    // with while normal. That is exactly the state the scrub exists to clear.
    const sourceRecord = await createSourceRecord({ sensitivity: "restricted" });
    await linkSourceRecord(sourceRecord.id, mara.id);
    const embeddedText = projectSourceRecordEmbeddedText(sourceRecord, [
      { id: mara.id, displayName: mara.displayName },
    ]);
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: mara.id,
      recordKind: "source_record",
      recordId: sourceRecord.id,
      embedding: [1, 0, 0, 0],
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText,
      contentFingerprint: fingerprintEmbeddedText({
        recordKind: "source_record",
        recordId: sourceRecord.id,
        embeddedText,
      }),
      trustLevel: "logged_context",
      sensitivity: "normal",
      sourceUpdatedAt: sourceRecord.updatedAt,
    });

    const result = await embedSourceRecord(sourceRecord.id);

    await expectScrubbed(result, harness);
  });

  /**
   * The row being gone is a stronger property than any predicate that withholds it: it
   * holds for every caller, including the one allowed to ask for restricted content
   * directly, and for any future query path that never learns to check sensitivity at all.
   */
  it("leaves nothing for even a direct request to retrieve", async () => {
    const { store, createApprovedMemory, embedMemory } = createHarness({ adapter: vectorAdapter });
    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);
    const search = (directlyRequested: boolean) =>
      queries.searchSemanticContext({
        ownerUserId: OWNER,
        query: "cooking gifts",
        limit: 10,
        minimumSimilarity: 0,
        directlyRequested,
      });
    const memory = await createApprovedMemory();
    await embedMemory(memory.id);

    const beforeRestriction = await search(false);
    const restricted = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { sensitivity: "restricted" },
    });
    await embedMemory(restricted.id);

    expect(beforeRestriction.map((result) => result.recordId)).toEqual([memory.id]);
    await expect(search(false)).resolves.toEqual([]);
    await expect(search(true)).resolves.toEqual([]);
    await expect(store.listRelationshipContextEmbeddings()).resolves.toEqual([]);
  });

  /**
   * The scrub must not be a one-way door. Lifting the restriction re-enqueues the record,
   * the reopened job re-decides it, and the text is embedded again from scratch - a fresh
   * row, because the fingerprint has nothing to reuse.
   */
  it("re-embeds cleanly once the restriction is lifted", async () => {
    const adapter = createCountingAdapter();
    const { store, createApprovedMemory, embedMemory } = createHarness({ adapter });
    const memory = await createApprovedMemory();
    const embedded = await embedMemory(memory.id);
    const restricted = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { sensitivity: "restricted" },
    });
    await embedMemory(restricted.id);

    const lifted = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { sensitivity: "normal" },
    });
    const reEmbedded = await embedMemory(lifted.id);
    const rows = await store.listRelationshipContextEmbeddings();

    expect(reEmbedded.outcome).toBe("completed");
    expect(rows).toHaveLength(1);
    expect(reEmbedded.embedding?.id).not.toBe(embedded.embedding?.id);
    expect(reEmbedded.embedding?.sensitivity).toBe("normal");
    expect(reEmbedded.embedding?.embeddedText).toBe(memory.content);
    expect(adapter.calls).toBe(2);
  });

  /**
   * Deliberately narrow: only `restricted_content` deletes. The other skip reasons describe
   * eligibility, not secrecy - an archived record is still the user's to read - and their
   * rows are withheld by the search predicates until the record is eligible again, so
   * keeping them spares a re-embed when it is.
   */
  it("keeps the row for skips that are about eligibility rather than secrecy", async () => {
    const {
      store,
      createPerson,
      createSourceRecord,
      linkSourceRecord,
      embedSourceRecord,
      auditActions,
    } = createHarness({ adapter: vectorAdapter });
    const mara = await createPerson("Mara Lin");
    const sourceRecord = await createSourceRecord();
    await linkSourceRecord(sourceRecord.id, mara.id);
    await embedSourceRecord(sourceRecord.id);

    await store.updateSourceRecordStatus({
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      status: "archived",
    });
    const result = await embedSourceRecord(sourceRecord.id);

    expect(result).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "source_record_not_active" }),
    );
    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);
    await expect(auditActions()).resolves.not.toContain("embedding_job.restricted_scrubbed");
  });
});

/**
 * The Drizzle adapter has no live-database unit test in this suite, so the two properties
 * that make its delete correct are asserted against its source: it is owner-scoped, and it
 * is model-agnostic. A model/version predicate creeping into this statement would leave
 * superseded-model rows - and their text - behind.
 */
describe("the Drizzle scrub deletes by record, not by model", () => {
  const drizzleStore = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
  const deleteMethod =
    drizzleStore
      .split("async deleteRelationshipContextEmbeddingsForRecord(input) {")[1]
      ?.split("\n    },")[0] ?? "";

  it("scopes the delete to the owner and the record", () => {
    expect(deleteMethod).toContain("delete(relationshipContextEmbeddings)");
    expect(deleteMethod).toContain(
      "eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId)",
    );
    expect(deleteMethod).toContain(
      "eq(relationshipContextEmbeddings.recordKind, input.recordKind)",
    );
    expect(deleteMethod).toContain("eq(relationshipContextEmbeddings.recordId, input.recordId)");
  });

  it("never narrows the delete to one embedding model or version", () => {
    expect(deleteMethod).not.toContain("embeddingModel");
    expect(deleteMethod).not.toContain("embeddingVersion");
  });
});
