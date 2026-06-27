import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

describe("semantic embedding jobs - source records", () => {
  it("embeds active retained person-linked source records as logged context", async () => {
    const { processor, createPerson, createSourceRecord, linkSourceRecord } = createHarness();
    const mara = await createPerson("Mara Lin");
    const sourceRecord = await createSourceRecord();
    await linkSourceRecord(sourceRecord.id, mara.id);
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "source_record",
      recordId: sourceRecord.id,
    });

    const result = await processor.processEmbeddingJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.embedding).toEqual(
      expect.objectContaining({
        ownerUserId: OWNER,
        personId: mara.id,
        recordKind: "source_record",
        recordId: sourceRecord.id,
        embeddedText: [
          "People: Mara Lin",
          "Logged context: Mara prefers handmade cooking gifts.",
        ].join("\n"),
        trustLevel: "logged_context",
        sensitivity: "normal",
      }),
    );
  });

  it("projects only minimized retained content and resolved person names", async () => {
    let embeddedText = "";
    const { processor, createPerson, createSourceRecord, linkSourceRecord } = createHarness({
      adapter: {
        async embedText(request) {
          embeddedText = request.text;
          return { vector: [0.1, 0.2, 0.3, 0.4], model: request.model, version: request.version };
        },
      },
    });
    const mara = await createPerson("Mara Lin");
    const sourceRecord = await createSourceRecord({
      metadataJson: {
        rawMessageLog: "raw transcript should not be embedded",
        semanticRetrievalKind: "interaction_summary",
        interactionType: "call",
      },
    });
    await linkSourceRecord(sourceRecord.id, mara.id);
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "source_record",
      recordId: sourceRecord.id,
    });

    await processor.processEmbeddingJob({ jobId: job.id });

    expect(embeddedText).toContain("Mara Lin");
    expect(embeddedText).toContain("Interaction type: call");
    expect(embeddedText).toContain("Mara prefers handmade cooking gifts.");
    expect(embeddedText).not.toContain("Raw provider text");
    expect(embeddedText).not.toContain("raw transcript");
  });

  it("skips source records that are inactive, restricted, provider-created, unretained, unresolved, ineligible, or personless", async () => {
    const { store, processor, createPerson, createSourceRecord, linkSourceRecord } =
      createHarness();
    const mara = await createPerson("Mara Lin");
    const inactive = await createSourceRecord({ status: "archived" });
    await linkSourceRecord(inactive.id, mara.id);
    const dismissed = await createSourceRecord({ status: "dismissed" });
    await linkSourceRecord(dismissed.id, mara.id);
    const pending = await createSourceRecord({ status: "pending_resolution" });
    await linkSourceRecord(pending.id, mara.id);
    const restricted = await createSourceRecord({ sensitivity: "restricted" });
    await linkSourceRecord(restricted.id, mara.id);
    const provider = await createSourceRecord({ sourceType: "gmail" });
    await linkSourceRecord(provider.id, mara.id);
    const generated = await createSourceRecord({ sourceType: "agent" });
    await linkSourceRecord(generated.id, mara.id);
    const unretained = await createSourceRecord({ retentionPolicy: "delete_after_processing" });
    await linkSourceRecord(unretained.id, mara.id);
    const unsupportedKind = await createSourceRecord({
      metadataJson: { semanticRetrievalKind: "generated_snapshot" },
    });
    await linkSourceRecord(unsupportedKind.id, mara.id);
    const unresolved = await createSourceRecord();
    await linkSourceRecord(unresolved.id, mara.id);
    await store.createUnresolvedMention({
      sourceRecordId: unresolved.id,
      mentionText: "Someone unresolved",
      candidatePersonIds: [],
    });
    const personless = await createSourceRecord();

    const cases = [
      [inactive.id, "source_record_not_active"],
      [dismissed.id, "source_record_not_active"],
      [pending.id, "source_record_not_active"],
      [restricted.id, "restricted_content"],
      [provider.id, "source_record_not_user_created"],
      [generated.id, "source_record_not_user_created"],
      [unretained.id, "source_record_not_retained"],
      [unsupportedKind.id, "source_record_not_note_or_summary"],
      [unresolved.id, "source_record_has_unresolved_mentions"],
      [personless.id, "source_record_not_person_linked"],
    ] as const;

    for (const [recordId, reason] of cases) {
      const { job } = await processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "source_record",
        recordId,
      });
      const result = await processor.processEmbeddingJob({ jobId: job.id });
      expect(result).toEqual(expect.objectContaining({ outcome: "skipped", reason }));
    }
  });
});
