import type { MessageDraft } from "@tendnote/domain";
import type { MutationOutcome } from "../affected-scopes";
import { affectedScopesForPerson } from "../people/affected-scopes";
import type { GenerateDraftOutcome } from "./generator";
import { createDraftLifecycle } from "./lifecycle";
import type { DraftLifecycleStore } from "./types";

/** Adds the affected-scope outcome contract to Message Draft lifecycle writes. */
export function createAffectedDraftLifecycle(store: DraftLifecycleStore) {
  const lifecycle = createDraftLifecycle(store);

  async function withAffectedScopes(
    resultPromise: Promise<MessageDraft>,
  ): Promise<MutationOutcome<MessageDraft>> {
    const result = await resultPromise;
    return {
      result,
      affectedScopes: affectedScopesForPerson({
        ownerUserId: result.ownerUserId,
        personId: result.personId,
      }),
    };
  }

  return {
    ...lifecycle,
    approveDraft: (input: Parameters<typeof lifecycle.approveDraft>[0]) =>
      withAffectedScopes(lifecycle.approveDraft(input)),
    dismissDraft: (input: Parameters<typeof lifecycle.dismissDraft>[0]) =>
      withAffectedScopes(lifecycle.dismissDraft(input)),
    markDraftSentManually: (input: Parameters<typeof lifecycle.markDraftSentManually>[0]) =>
      withAffectedScopes(lifecycle.markDraftSentManually(input)),
    editDraftBody: (input: Parameters<typeof lifecycle.editDraftBody>[0]) =>
      withAffectedScopes(lifecycle.editDraftBody(input)),
  };
}

export function draftGenerationOutcome(
  result: GenerateDraftOutcome,
): MutationOutcome<GenerateDraftOutcome> {
  return {
    result,
    affectedScopes:
      result.status === "created"
        ? affectedScopesForPerson({
            ownerUserId: result.draft.ownerUserId,
            personId: result.draft.personId,
          })
        : [],
  };
}

export function createAffectedDraftGenerator<TInput>(generator: {
  generateDraft(input: TInput): Promise<GenerateDraftOutcome>;
}) {
  return {
    generateDraft: (input: TInput) => generator.generateDraft(input).then(draftGenerationOutcome),
  };
}

export function createAffectedDraftRegeneration<TInput>(regeneration: {
  regenerateDraft(input: TInput): Promise<GenerateDraftOutcome>;
}) {
  return {
    regenerateDraft: (input: TInput) =>
      regeneration.regenerateDraft(input).then(draftGenerationOutcome),
  };
}
