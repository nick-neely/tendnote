"use server";

import { parseExplicitMemoryRequest, sensitivitySchema } from "@tendnote/domain";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { captureExplicitMemoryWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";

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
}): Promise<ExplicitMemoryCaptureView> {
  const parsedInput = captureExplicitMemorySchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const { content } = parseExplicitMemoryRequest(parsedInput.request);

  const { memory, sourceRecord, person } = await captureExplicitMemoryWithEmbeddingDelivery({
    ownerUserId,
    personId: parsedInput.personId,
    content,
    sensitivity: parsedInput.sensitivity,
    metadataJson: { captureSurface: "person_profile_assistant" },
  });

  return {
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
  };
}
