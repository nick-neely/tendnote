"use server";

import { parseExplicitMemoryRequest, sensitivitySchema } from "@tendnote/domain";
import { z } from "zod";
import { captureExplicitMemoryWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";
import { runOwnerAction } from "@/lib/owner-action";

const captureExplicitMemorySchema = z.object({
  personId: z.uuid(),
  request: z.string().trim().min(1).max(4000),
  sensitivity: sensitivitySchema.optional(),
});

export type ExplicitMemoryCaptureView = {
  memory: {
    id: string;
    personId: string;
    content: string;
    status: string;
    sensitivity: string;
    confidence: string;
    sourceRecordId: string;
    approvedAt: string | null;
  };
  sourceRecord: {
    id: string;
    status: string;
  };
  person: {
    id: string;
    displayName: string;
  };
};

export async function captureExplicitMemoryForPerson(input: {
  personId: string;
  request: string;
  sensitivity?: "normal" | "sensitive" | "restricted";
}) {
  return runOwnerAction({
    schema: captureExplicitMemorySchema,
    input,
    body: ({ ownerUserId, input: parsed }) => {
      const { content } = parseExplicitMemoryRequest(parsed.request);
      return captureExplicitMemoryWithEmbeddingDelivery({
        ownerUserId,
        personId: parsed.personId,
        content,
        sensitivity: parsed.sensitivity,
        metadataJson: { captureSurface: "person_profile_assistant" },
      });
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: ({ result: { memory, sourceRecord, person } }) => ({
      memory: {
        id: memory.id,
        personId: memory.personId,
        content: memory.content,
        status: memory.status,
        sensitivity: memory.sensitivity,
        confidence: memory.confidence,
        sourceRecordId: memory.sourceRecordId,
        approvedAt: memory.approvedAt?.toISOString() ?? null,
      },
      sourceRecord: {
        id: sourceRecord.id,
        status: sourceRecord.status,
      },
      person: {
        id: person.id,
        displayName: person.displayName,
      },
    }),
  });
}
