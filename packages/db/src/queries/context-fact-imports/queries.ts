import {
  type ContextFactImportCandidate,
  ContextFactValidationError,
  contextFactImportProvider,
  contextFactImportProviderSchema,
  createDeterministicContextFactImportExtractionAdapter,
  MAX_CONTEXT_FACT_IMPORT_TEXT_LENGTH,
  parseContextFactImportBlock,
  validateContextFactImportCandidates,
} from "@tendnote/domain";
import { z } from "zod";
import type { AffectedScope } from "../affected-scopes";
import { createContextFactQueries } from "../context-facts/queries";
import type { SuggestedContextFactReviewResult } from "../context-facts/types";
import type {
  ContextFactImport,
  ContextFactImportStore,
  CreateContextFactImportQueriesOptions,
  ImportSelfContextFactsInput,
  ImportSelfContextFactsResult,
} from "./types";

const importSelfContextFactsInputSchema = z
  .object({
    callerUserId: z.string().trim().min(1),
    provider: contextFactImportProviderSchema,
    text: z
      .string()
      .trim()
      .min(1, "Paste what the assistant gave you.")
      .max(
        MAX_CONTEXT_FACT_IMPORT_TEXT_LENGTH,
        "That paste is too long. Bring over the list of facts rather than the whole conversation.",
      ),
  })
  .strict();

type PersistedCandidates = {
  reviews: SuggestedContextFactReviewResult[];
  suggestedCount: number;
  alreadyPendingCount: number;
  skippedCount: number;
  affectedScopes: AffectedScope[];
};

export function createContextFactImportQueries(
  store: ContextFactImportStore,
  options: CreateContextFactImportQueriesOptions = {},
) {
  const extractionAdapter =
    options.extractionAdapter ?? createDeterministicContextFactImportExtractionAdapter();
  const contextFactQueries = createContextFactQueries(store, {
    resolveVerifiedCaller: options.resolveVerifiedCaller,
  });

  async function persistCandidates(input: {
    callerUserId: string;
    candidates: readonly ContextFactImportCandidate[];
    importRecord: ContextFactImport;
  }): Promise<PersistedCandidates> {
    const reviews: SuggestedContextFactReviewResult[] = [];
    const affectedScopes = new Map<string, AffectedScope>();
    let suggestedCount = 0;
    let alreadyPendingCount = 0;
    let skippedCount = 0;

    for (const candidate of input.candidates) {
      try {
        const outcome = await contextFactQueries.createSuggestedSelfContextFact({
          callerUserId: input.callerUserId,
          category: candidate.category,
          content: candidate.content,
          sensitivity: candidate.sensitivity,
          // Import provenance points at the real import record, which is what makes an
          // imported fact traceable back to the session that proposed it.
          provenance: {
            channel: "import",
            origin: "import",
            sourceRecordId: input.importRecord.id,
          },
          suggestionEvidence: candidate.evidence,
        });

        reviews.push(outcome.result);
        if (outcome.decision === "created") {
          suggestedCount += 1;
          for (const scope of outcome.affectedScopes) {
            affectedScopes.set(JSON.stringify(scope), scope);
          }
        } else {
          alreadyPendingCount += 1;
        }
      } catch (error) {
        // A statement the owner already dismissed stays dismissed, and that is review
        // policy rather than an import failure. Anything else must still reject.
        if (!(error instanceof ContextFactValidationError)) throw error;
        skippedCount += 1;
      }
    }

    return {
      reviews,
      suggestedCount,
      alreadyPendingCount,
      skippedCount,
      affectedScopes: [...affectedScopes.values()],
    };
  }

  /**
   * Read one paste from another assistant into review-gated Self Context.
   *
   * The fenced Tendnote block is the fast path and never leaves the app. Loose prose
   * falls back to one bounded extraction call over exactly this paste — no owner
   * history travels with it. Either way the result is `suggested` facts the owner
   * still has to accept, because a third-party assistant's output is not authority.
   */
  async function importSelfContextFacts(
    input: ImportSelfContextFactsInput,
  ): Promise<ImportSelfContextFactsResult> {
    const parsed = importSelfContextFactsInputSchema.parse(input);
    // The same gate every Context Fact mutation uses: the caller is resolved from the
    // authenticated session, never from the request payload.
    const verifiedCallerUserId = await options.resolveVerifiedCaller?.();
    if (!verifiedCallerUserId || verifiedCallerUserId !== parsed.callerUserId) {
      throw new Error("A verified caller is required.");
    }
    const callerUserId = verifiedCallerUserId;

    const provider = contextFactImportProvider(parsed.provider);
    const block = parseContextFactImportBlock(parsed.text, provider);
    const source = block ? "block" : "extraction";
    const rawCandidates = block
      ? block.candidates
      : ((await extractionAdapter.extractCandidates({ text: parsed.text })).candidates ?? []);

    const validated = validateContextFactImportCandidates({ candidates: rawCandidates });
    const unreadableCount = (block?.unreadableLineCount ?? 0) + validated.rejectedCandidateCount;

    const importRecord = await store.createContextFactImport({
      ownerUserId: callerUserId,
      provider: parsed.provider,
      source,
      textLength: parsed.text.length,
      candidateCount: validated.validCandidates.length,
    });

    const persisted = await persistCandidates({
      callerUserId,
      candidates: validated.validCandidates,
      importRecord,
    });

    await store.createAuditLogEntry({
      ownerUserId: callerUserId,
      action: "context_fact_import.completed",
      entityType: "context_fact_import",
      entityId: importRecord.id,
      metadataJson: {
        provider: parsed.provider,
        source,
        textLength: parsed.text.length,
        candidateCount: validated.validCandidates.length,
        suggestedCount: persisted.suggestedCount,
        alreadyPendingCount: persisted.alreadyPendingCount,
        skippedCount: persisted.skippedCount,
        unreadableCount,
        adapterKind: extractionAdapter.kind,
        ...(extractionAdapter.model ? { extractionModel: extractionAdapter.model } : {}),
        ...(extractionAdapter.promptVersion
          ? { promptVersion: extractionAdapter.promptVersion }
          : {}),
      },
    });

    return {
      summary: {
        importId: importRecord.id,
        provider: parsed.provider,
        source,
        suggestedCount: persisted.suggestedCount,
        alreadyPendingCount: persisted.alreadyPendingCount,
        skippedCount: persisted.skippedCount,
        unreadableCount,
      },
      reviews: persisted.reviews,
      affectedScopes: persisted.affectedScopes,
    };
  }

  return {
    importSelfContextFacts,
    listContextFactImports: (callerUserId: string) =>
      store.listContextFactImports({ ownerUserId: callerUserId }),
  };
}
