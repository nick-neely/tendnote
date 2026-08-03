import { z } from "zod";
import { selfContextFactCategorySchema } from "./context-facts";
import { type Sensitivity, sensitivitySchema } from "./privacy";

/** The extraction contract is intentionally small so the model never receives owner history. */
export const contextFactExtractionPromptVersion = "context-fact-extraction.v1";
export const MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH = 2_000;
export const MAX_CONTEXT_FACT_EVIDENCE_LENGTH = 240;
export const CONTEXT_FACT_EXTRACTION_MAX_CANDIDATES = 3;
export const MAX_PENDING_CONTEXT_FACT_SUGGESTIONS_PER_OWNER = 20;

export const contextFactExtractionCandidateSchema = z
  .object({
    category: selfContextFactCategorySchema,
    content: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(MAX_CONTEXT_FACT_EVIDENCE_LENGTH),
    sensitivity: sensitivitySchema.optional(),
  })
  .strict();

export type ContextFactExtractionCandidate = z.infer<typeof contextFactExtractionCandidateSchema>;

export const contextFactExtractionAdapterResultSchema = z.object({
  candidates: z.array(z.unknown()).default([]),
});

export type ContextFactExtractionAdapterResult = z.infer<
  typeof contextFactExtractionAdapterResultSchema
>;

export type ContextFactExtractionInput = {
  /** Only the current accepted inbound message is allowed into an adapter. */
  message: string;
};

export type ContextFactExtractionAdapter = {
  kind: "deterministic" | "fake" | "llm";
  model?: string;
  promptVersion?: string;
  extractCandidates: (
    input: ContextFactExtractionInput,
  ) => Promise<ContextFactExtractionAdapterResult>;
};

export type ValidateContextFactExtractionCandidatesResult = {
  validCandidates: ContextFactExtractionCandidate[];
  invalidCandidateCount: number;
};

const restrictedEvidencePattern =
  /\b(?:ssn|social security|password|passcode|bank account|credit card|salary|income|money|financial|debt|mortgage|diagnos(?:is|ed)|medication|medical|therapy|pregnan(?:t|cy)|sexual|sex life|legal case)\b|\b\d{1,5}\s+\S+(?:\s+\S+){0,3}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd)\b/i;

// These are intentionally conservative. A candidate can still be reviewed when a user
// directly states a stable preference or background fact, but the model must not turn a
// transient state or an inferred persona into durable context.
const nonOrientingCandidatePattern =
  /\b(?:i feel|i'm feeling|i am feeling|feeling|today|tonight|this week|right now|currently|at the moment|lately|temporar(?:y|ily)|stressed|overwhelmed|exhausted|tired|sick|ill|anxious|sad|happy|angry|upset|excited|introvert|extrovert|personality|good person|bad person|i value|my values|i believe|i tend to|i can|i can't|i am able|i'm able|capable|my ability|good at|bad at|skilled|expert|wealthy|rich|poor|salary|income|money|financial|debt|mortgage|rent|afford|daily|weekly|every morning|every night|routine|habit|diet|exercise|workout|sleep schedule|runs every|running every|travels every)\b/i;

const stopWords = new Set([
  "a",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "for",
  "from",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "the",
  "this",
  "to",
  "with",
  "works",
  "lives",
  "shared",
]);

function normalizedTokens(value: string) {
  return (
    value
      .toLocaleLowerCase("en-US")
      .normalize("NFKC")
      .match(/[a-z0-9]+/g)
      ?.map((token) => (token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token))
      .filter((token) => !stopWords.has(token)) ?? []
  );
}

function contentIsSupportedByMessage(content: string, message: string) {
  const candidateTokens = normalizedTokens(content);
  if (candidateTokens.length === 0) return false;
  const messageTokens = new Set(normalizedTokens(message));
  return candidateTokens.every((token) => messageTokens.has(token));
}

function minimumSensitivityForEvidence(evidence: string): Sensitivity {
  return restrictedEvidencePattern.test(evidence) ? "restricted" : "normal";
}

function sensitivityRank(value: Sensitivity) {
  return value === "restricted" ? 3 : value === "sensitive" ? 2 : 1;
}

function atLeastSensitivity(base: Sensitivity, candidate: Sensitivity | undefined): Sensitivity {
  if (!candidate || sensitivityRank(candidate) < sensitivityRank(base)) return base;
  return candidate;
}

function isCandidateAllowed(candidate: ContextFactExtractionCandidate, message: string) {
  if (!message.includes(candidate.evidence)) return false;
  if (!contentIsSupportedByMessage(candidate.content, message)) return false;
  if (nonOrientingCandidatePattern.test(candidate.content)) return false;
  if (nonOrientingCandidatePattern.test(candidate.evidence)) return false;
  return true;
}

/**
 * Validates and minimizes model output at the shared domain seam. The evidence must be an
 * exact bounded excerpt of the current message; the caller never needs to persist raw input.
 */
export function validateContextFactExtractionCandidates(
  adapterResult: unknown,
  input: ContextFactExtractionInput,
): ValidateContextFactExtractionCandidatesResult {
  const message = input.message.trim();
  if (message.length === 0 || message.length > MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH) {
    return { validCandidates: [], invalidCandidateCount: 1 };
  }

  const parsedResult = contextFactExtractionAdapterResultSchema.safeParse(adapterResult);
  if (!parsedResult.success) {
    return { validCandidates: [], invalidCandidateCount: 1 };
  }

  const validCandidates: ContextFactExtractionCandidate[] = [];
  let invalidCandidateCount = Math.max(
    0,
    parsedResult.data.candidates.length - CONTEXT_FACT_EXTRACTION_MAX_CANDIDATES,
  );

  for (const candidate of parsedResult.data.candidates.slice(
    0,
    CONTEXT_FACT_EXTRACTION_MAX_CANDIDATES,
  )) {
    const parsed = contextFactExtractionCandidateSchema.safeParse(candidate);
    if (!parsed.success || !isCandidateAllowed(parsed.data, message)) {
      invalidCandidateCount += 1;
      continue;
    }

    validCandidates.push({
      ...parsed.data,
      sensitivity: atLeastSensitivity(
        minimumSensitivityForEvidence(parsed.data.evidence),
        parsed.data.sensitivity,
      ),
    });
  }

  return { validCandidates, invalidCandidateCount };
}

export function createDeterministicContextFactExtractionAdapter(): ContextFactExtractionAdapter {
  return {
    kind: "deterministic",
    promptVersion: contextFactExtractionPromptVersion,
    async extractCandidates() {
      // Deterministic CI/local behavior deliberately produces no ambient suggestions. It is
      // useful for exercising queue mechanics without making a model-quality claim.
      return { candidates: [] };
    },
  };
}

export function createFakeContextFactExtractionAdapter(
  candidates: ContextFactExtractionCandidate[],
): ContextFactExtractionAdapter {
  return {
    kind: "fake",
    promptVersion: contextFactExtractionPromptVersion,
    async extractCandidates() {
      return { candidates };
    },
  };
}
