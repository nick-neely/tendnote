import type { GenerateDraftInput, GenerateDraftOutcome } from "./generator";
import type { DraftActionInput } from "./lifecycle";
import type { DraftLifecycleStore } from "./types";

export type DraftRegenerationDeps = {
  store: DraftLifecycleStore;
  // The shared generator, injected as a function so this factory stays free of the
  // adapter/person-context wiring and cannot fork generation policy.
  generateDraft: (input: GenerateDraftInput) => Promise<GenerateDraftOutcome>;
};

/**
 * Explicit, auditable draft regeneration (PRD #75, issue #78, user story #22). It
 * generates a brand-new draft from the prior draft's person and grounding intent —
 * its purpose, channel, and any follow-up / brief-item source references — and
 * records a regeneration link. The prior draft is left untouched, so reviewed text
 * is never silently replaced: the user keeps both and dismisses whichever they
 * don't want. Memory/source-record grounding is intentionally re-derived from
 * fresh person context by the generator, so a regenerate reflects current facts.
 */
export function createDraftRegeneration({ store, generateDraft }: DraftRegenerationDeps) {
  return {
    async regenerateDraft(input: DraftActionInput): Promise<GenerateDraftOutcome> {
      const prior = await store.getDraft(input);

      if (!prior) {
        throw new Error("Message draft not found.");
      }

      const followupRef = prior.sourceRefs.find((ref) => ref.kind === "followup");
      const briefRef = prior.sourceRefs.find((ref) => ref.kind === "brief_item");

      const outcome = await generateDraft({
        ownerUserId: input.ownerUserId,
        personId: prior.personId,
        channel: prior.channel,
        purpose: prior.purpose,
        followupContext: followupRef
          ? { id: followupRef.id, reason: followupRef.label }
          : undefined,
        briefItemContext: briefRef ? { id: briefRef.id, title: briefRef.label } : undefined,
      });

      if (outcome.status === "created") {
        await store.createAuditLogEntry({
          ownerUserId: input.ownerUserId,
          action: "message_draft.regenerated",
          entityType: "message_draft",
          entityId: outcome.draft.id,
          metadataJson: { personId: prior.personId, priorDraftId: prior.id },
        });
      }

      return outcome;
    },
  };
}
