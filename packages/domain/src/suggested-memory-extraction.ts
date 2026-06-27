import { z } from "zod";
import { memoryTypeSchema } from "./memories";
import { confidenceSchema, type Sensitivity, sensitivitySchema } from "./privacy";
import type { SourceRecord } from "./source-records";

export const suggestedMemoryExtractionPromptVersion = "suggested-memory-extraction.v1";

export type SuggestedMemoryExtractionPerson = {
  id: string;
  displayName: string;
};

export type SuggestedMemoryExtractionInput = {
  sourceRecord: Pick<
    SourceRecord,
    "id" | "content" | "ownerUserId" | "sensitivity" | "confidence" | "importance"
  >;
  resolvedPeople: SuggestedMemoryExtractionPerson[];
};

export const suggestedMemoryCandidateSchema = z.object({
  personId: z.string().min(1),
  content: z.string().trim().min(1),
  memoryType: memoryTypeSchema.default("context"),
  importance: z.number().int().min(1).max(5).optional(),
  confidence: confidenceSchema.optional(),
  sensitivity: sensitivitySchema.optional(),
});

export type SuggestedMemoryCandidate = z.infer<typeof suggestedMemoryCandidateSchema>;

export const suggestedMemoryExtractionAdapterResultSchema = z.object({
  candidates: z.array(z.unknown()).default([]),
});

export type SuggestedMemoryExtractionAdapterResult = z.infer<
  typeof suggestedMemoryExtractionAdapterResultSchema
>;

export type SuggestedMemoryExtractionAdapter = {
  kind: "deterministic" | "fake" | "llm";
  model?: string;
  promptVersion?: string;
  extractCandidates: (
    input: SuggestedMemoryExtractionInput,
  ) => Promise<SuggestedMemoryExtractionAdapterResult>;
};

export type ValidateSuggestedMemoryCandidatesResult = {
  validCandidates: SuggestedMemoryCandidate[];
  invalidCandidateCount: number;
};

export function validateSuggestedMemoryCandidates(
  adapterResult: unknown,
  input: Pick<SuggestedMemoryExtractionInput, "resolvedPeople">,
): ValidateSuggestedMemoryCandidatesResult {
  const parsedResult = suggestedMemoryExtractionAdapterResultSchema.safeParse(adapterResult);

  if (!parsedResult.success) {
    return { validCandidates: [], invalidCandidateCount: 1 };
  }

  const allowedPersonIds = new Set(input.resolvedPeople.map((person) => person.id));
  const validCandidates: SuggestedMemoryCandidate[] = [];
  let invalidCandidateCount = 0;

  for (const candidate of parsedResult.data.candidates) {
    const parsed = suggestedMemoryCandidateSchema.safeParse(candidate);

    if (!parsed.success || !allowedPersonIds.has(parsed.data.personId)) {
      invalidCandidateCount += 1;
      continue;
    }

    validCandidates.push(parsed.data);
  }

  return { validCandidates, invalidCandidateCount };
}

const sensitivityRank: Record<Sensitivity, number> = {
  normal: 1,
  sensitive: 2,
  restricted: 3,
};

export function stricterSensitivity(
  baseSensitivity: Sensitivity,
  candidateSensitivity: Sensitivity | undefined,
) {
  if (!candidateSensitivity) {
    return baseSensitivity;
  }

  return sensitivityRank[candidateSensitivity] > sensitivityRank[baseSensitivity]
    ? candidateSensitivity
    : baseSensitivity;
}

export function createDeterministicSuggestedMemoryExtractionAdapter(): SuggestedMemoryExtractionAdapter {
  return {
    kind: "deterministic",
    promptVersion: suggestedMemoryExtractionPromptVersion,
    async extractCandidates(input) {
      return {
        candidates: input.resolvedPeople.map((person) => ({
          personId: person.id,
          content: input.sourceRecord.content,
          memoryType: "context",
          importance: input.sourceRecord.importance,
          confidence: input.sourceRecord.confidence,
          sensitivity: input.sourceRecord.sensitivity,
        })),
      };
    },
  };
}

export function createFakeSuggestedMemoryExtractionAdapter(
  candidates: SuggestedMemoryCandidate[],
): SuggestedMemoryExtractionAdapter {
  return {
    kind: "fake",
    promptVersion: suggestedMemoryExtractionPromptVersion,
    async extractCandidates() {
      return { candidates };
    },
  };
}
