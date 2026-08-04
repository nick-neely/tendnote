import {
  type ContextFactImportCandidate,
  type ContextFactImportProviderId,
  ContextFactValidationError,
  contextFactImportProvider,
  contextFactImportProviderSchema,
  contextFactImportTextSchema,
  createDeterministicContextFactImportExtractionAdapter,
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
    text: contextFactImportTextSchema,
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
   * Turn one paste into candidates.
   *
   * The fenced Tendnote block is the fast path and never leaves the app. A fence
   * the assistant filled with malformed lines is no more readable than no fence at
   * all, so an empty block falls through to extraction rather than reporting
   * nothing found, and its unreadable line count still travels with the result.
   */
  async function readPaste(input: { text: string; provider: ContextFactImportProviderId }) {
    const block = parseContextFactImportBlock(
      input.text,
      contextFactImportProvider(input.provider),
    );
    const readableBlock = block && block.candidates.length > 0 ? block : null;
    const candidates = readableBlock
      ? readableBlock.candidates
      : ((await extractionAdapter.extractCandidates({ text: input.text })).candidates ?? []);
    const validated = validateContextFactImportCandidates({ candidates });

    return {
      source: readableBlock ? ("block" as const) : ("extraction" as const),
      validCandidates: validated.validCandidates,
      unreadableCount: (block?.unreadableLineCount ?? 0) + validated.rejectedCandidateCount,
      // `source: "extraction"` only says the paste held no readable block. Without
      // gateway credentials the deterministic adapter runs and nothing reads it, and
      // the surface must not claim a model did.
      readByModel: !readableBlock && extractionAdapter.kind === "llm",
    };
  }

  function adapterProvenance() {
    return {
      adapterKind: extractionAdapter.kind,
      ...(extractionAdapter.model ? { extractionModel: extractionAdapter.model } : {}),
      ...(extractionAdapter.promptVersion
        ? { promptVersion: extractionAdapter.promptVersion }
        : {}),
    };
  }

  /**
   * Read one paste from another assistant into review-gated Self Context.
   *
   * Loose prose costs one bounded extraction call over exactly this paste, and no
   * owner history travels with it. Either way the result is `suggested` facts the
   * owner still has to accept, because a third-party assistant's output is not
   * authority.
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

    const read = await readPaste({ text: parsed.text, provider: parsed.provider });
    const importRecord = await store.createContextFactImport({
      ownerUserId: callerUserId,
      provider: parsed.provider,
      source: read.source,
      textLength: parsed.text.length,
      candidateCount: read.validCandidates.length,
    });
    const persisted = await persistCandidates({
      callerUserId,
      candidates: read.validCandidates,
      importRecord,
    });
    const summary = {
      importId: importRecord.id,
      provider: parsed.provider,
      source: read.source,
      suggestedCount: persisted.suggestedCount,
      alreadyPendingCount: persisted.alreadyPendingCount,
      skippedCount: persisted.skippedCount,
      unreadableCount: read.unreadableCount,
      readByModel: read.readByModel,
    };

    await store.createAuditLogEntry({
      ownerUserId: callerUserId,
      action: "context_fact_import.completed",
      entityType: "context_fact_import",
      entityId: importRecord.id,
      metadataJson: {
        ...summary,
        textLength: parsed.text.length,
        candidateCount: read.validCandidates.length,
        ...adapterProvenance(),
      },
    });

    return { summary, reviews: persisted.reviews, affectedScopes: persisted.affectedScopes };
  }

  return { importSelfContextFacts };
}
