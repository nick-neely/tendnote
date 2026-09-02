import {
  type DraftGroundedContext,
  type DraftProposalResult,
  type DraftSourceRef,
  draftProposalResultSchema,
  draftSourceRefTrustForKind,
  hasGroundedDraftContext,
  type Memory,
  type MessageDraftChannel,
  type MessageDraftPurpose,
  type SourceRecord,
} from "@tendnote/domain";
import { createDefaultDraftAdapter } from "./drafts";
import type { DraftAdapter } from "./drafts/draft-adapter";
import { createDrizzleDraftLifecycleStore } from "./drafts/drizzle-store";
import { draftGenerationOutcome } from "./drafts/mutation-lifecycle";
import { draftProposalDigest, draftProposalDigestMatches } from "./drafts/proposal-digest";
import type { DraftLifecycleStore } from "./drafts/types";
import type { GetPersonContextInput, PersonContextResult } from "./person-context";
import { getPersonContext } from "./person-context";

export type DraftProposalSkipReason =
  | "person_not_found"
  | "insufficient_context"
  | "generation_failed";

export type ProposeDraftInput = {
  ownerUserId: string;
  personId: string;
  channel?: MessageDraftChannel;
  purpose?: MessageDraftPurpose;
  toneInstruction?: string;
  toneVariants?: string[];
  /**
   * Whether restricted-sensitivity context may ground this proposal.
   *
   * A caller-side decision, never a model argument: the subagent that proposes
   * drafts pins it to false because a delegated turn has nobody to ask, and the
   * root's `create_message_draft` reaches it through `includeRestricted`, which
   * parks for the owner's own approval before the call runs (ADR 0058).
   */
  directlyRequested?: boolean;
  revisionContext?: { body: string; instruction?: string };
  followupContext?: { id: string; reason: string };
  briefItemContext?: { id: string; title: string; reason?: string };
};

export type DraftProposalPersonContextSource = {
  getPersonContext: (input: GetPersonContextInput) => Promise<PersonContextResult>;
};

export type DraftProposalOptions = {
  draftAdapter: DraftAdapter;
};

export type PersistAcceptedDraftProposalInput = {
  ownerUserId: string;
  personId: string;
  channel?: MessageDraftChannel;
  purpose?: MessageDraftPurpose;
  body: string;
  sourceRefs: DraftSourceRef[];
  /**
   * The `digest` the accepted variant carried out of `proposeDraft`. Required: it
   * is what makes `message_draft.accepted_proposal` a statement about wording this
   * seam actually issued rather than about whatever its caller assembled.
   */
  proposalDigest: string;
};

const MAX_LABEL_LENGTH = 200;
const DEFAULT_VARIANTS = ["warm", "concise", "direct"] as const;

function toLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL_LENGTH ? `${trimmed.slice(0, MAX_LABEL_LENGTH - 1)}…` : trimmed;
}

function memoryRef(memory: Memory, kind: "approved_memory" | "suggested_memory"): DraftSourceRef {
  return {
    kind,
    id: memory.id,
    label: toLabel(memory.content),
    trust: draftSourceRefTrustForKind(kind),
  };
}

function sourceRecordRef(record: SourceRecord): DraftSourceRef {
  return {
    kind: "source_record",
    id: record.id,
    label: toLabel(record.content),
    trust: draftSourceRefTrustForKind("source_record"),
  };
}

export function createDraftProposalGenerator(
  personContext: DraftProposalPersonContextSource,
  options: DraftProposalOptions,
) {
  return {
    async proposeDraft(input: ProposeDraftInput): Promise<DraftProposalResult> {
      const channel = input.channel ?? "text";
      const purpose = input.purpose ?? "other";
      const context = await personContext.getPersonContext({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        directlyRequested: input.directlyRequested,
      });

      if (!context.person) {
        return skipped(input.ownerUserId, "person_not_found");
      }

      const sourceRefs = buildSourceRefs(context, input);
      const grounded: DraftGroundedContext = {
        person: {
          displayName: context.person.displayName,
          relationshipType: context.person.relationshipType,
        },
        channel,
        purpose,
        facts: context.approvedMemories.map((memory) => memory.content),
        loggedContext: context.sourceRecords.map((record) => record.content),
        tentative: context.suggestedMemories.map((memory) => memory.content),
        followupReason: input.followupContext?.reason,
        briefReason: input.briefItemContext?.reason ?? input.briefItemContext?.title,
        toneInstruction: input.toneInstruction,
      };

      if (!hasGroundedDraftContext(grounded) || sourceRefs.length === 0) {
        return skipped(input.ownerUserId, "insufficient_context");
      }

      const tones = normalizeToneVariants(input);
      try {
        const variants = await Promise.all(
          tones.map(async (tone, index) => {
            const generated = await options.draftAdapter({
              ...grounded,
              toneInstruction: proposalToneInstruction(tone, input.revisionContext),
            });
            const body = generated.body.trim();
            if (!body) {
              throw new Error("Draft proposal adapter returned an empty body.");
            }
            return {
              id: `variant-${index + 1}`,
              label: labelTone(tone, index),
              toneInstruction: tone,
              body,
              // Stamped here, where the wording and its grounding are both in hand,
              // so accepting this variant later can be checked against what was
              // proposed rather than trusted.
              digest: draftProposalDigest({ body, sourceRefs }),
            };
          }),
        );

        return draftProposalResultSchema.parse({
          ownerUserId: input.ownerUserId,
          proposal: {
            id: `draft_proposal:${input.personId}:${tones.join("|")}`,
            ownerUserId: input.ownerUserId,
            personId: input.personId,
            personDisplayName: context.person.displayName,
            channel,
            purpose,
            variants,
            sourceRefs,
            ephemeral: true,
            persistenceRequiresExplicitOwnerIntent: true,
          },
          skippedReason: null,
          component: {
            type: "draft_proposal",
            proposalId: `draft_proposal:${input.personId}:${tones.join("|")}`,
          },
        });
      } catch {
        return skipped(input.ownerUserId, "generation_failed");
      }
    },
  };
}

export function createAcceptedDraftProposalPersister(store: DraftLifecycleStore) {
  return {
    async persistAcceptedDraftProposal(input: PersistAcceptedDraftProposalInput) {
      const channel = input.channel ?? "text";
      const purpose = input.purpose ?? "other";
      /**
       * The body and the references are the whole record: the draft's text, the
       * grounding the owner will see attached to it, and the ids the audit entry
       * names. Checking the digest first means this seam persists only wording a
       * `proposeDraft` call produced, so a body edited between the proposal and the
       * acceptance cannot arrive wearing that proposal's provenance. It is a
       * content check, not an authorisation: the caller still owes the owner's
       * decision, which on the Eve path is the approval that parks the
       * `acceptedProposal` call.
       */
      if (
        !draftProposalDigestMatches({
          body: input.body,
          sourceRefs: input.sourceRefs,
          digest: input.proposalDigest,
        })
      ) {
        throw new Error(
          "This draft body and its source references do not match the proposal they claim to come from.",
        );
      }
      const person = await store.getPerson({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
      });
      if (!person) {
        throw new Error("Cannot persist an accepted draft proposal for an unknown person.");
      }
      const draft = await store.createDraft({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        channel,
        purpose,
        body: input.body,
        status: "draft",
        sourceRefs: input.sourceRefs,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "message_draft.accepted_proposal",
        entityType: "message_draft",
        entityId: draft.id,
        metadataJson: {
          personId: input.personId,
          purpose,
          channel,
          sourceRefKinds: input.sourceRefs.map((ref) => ref.kind),
          sourceRefIds: input.sourceRefs.map((ref) => ref.id),
        },
      });

      return draftGenerationOutcome({ status: "created" as const, draft });
    },
  };
}

function skipped(ownerUserId: string, reason: DraftProposalSkipReason): DraftProposalResult {
  return draftProposalResultSchema.parse({
    ownerUserId,
    proposal: null,
    skippedReason: reason,
    component: { type: "draft_proposal", proposalId: null },
  });
}

function normalizeToneVariants(input: ProposeDraftInput): string[] {
  const variants = input.toneVariants?.map((variant) => variant.trim()).filter(Boolean);
  if (variants && variants.length > 0) {
    return [...new Set(variants)].slice(0, 3);
  }
  if (input.toneInstruction?.trim()) {
    return [...new Set([input.toneInstruction.trim(), "concise", "warmer"])].slice(0, 3);
  }
  return [...DEFAULT_VARIANTS];
}

function labelTone(tone: string, index: number) {
  const normalized = tone.toLowerCase();
  if (normalized.includes("concise") || normalized.includes("short")) return "Concise";
  if (normalized.includes("warm")) return "Warm";
  if (normalized.includes("direct")) return "Direct";
  if (normalized.includes("professional")) return "Professional";
  if (normalized.includes("casual")) return "Casual";
  return `Variant ${index + 1}`;
}

function proposalToneInstruction(
  tone: string,
  revisionContext: ProposeDraftInput["revisionContext"],
) {
  if (!revisionContext) {
    return tone;
  }

  const instruction = revisionContext.instruction?.trim() || tone;
  return `Revise the existing draft with this request: ${instruction}\nExisting draft:\n${revisionContext.body}`;
}

function buildSourceRefs(context: PersonContextResult, input: ProposeDraftInput): DraftSourceRef[] {
  const refs: DraftSourceRef[] = [
    ...context.approvedMemories.map((memory) => memoryRef(memory, "approved_memory")),
    ...context.sourceRecords.map(sourceRecordRef),
    ...context.suggestedMemories.map((memory) => memoryRef(memory, "suggested_memory")),
  ];

  if (input.followupContext) {
    refs.push({
      kind: "followup",
      id: input.followupContext.id,
      label: toLabel(input.followupContext.reason),
      trust: draftSourceRefTrustForKind("followup"),
    });
  }

  if (input.briefItemContext) {
    refs.push({
      kind: "brief_item",
      id: input.briefItemContext.id,
      label: toLabel(input.briefItemContext.reason ?? input.briefItemContext.title),
      trust: draftSourceRefTrustForKind("brief_item"),
    });
  }

  return refs;
}

const defaultDraftProposalGenerator = createDraftProposalGenerator(
  { getPersonContext },
  { draftAdapter: createDefaultDraftAdapter() },
);
const defaultAcceptedDraftProposalPersister = createAcceptedDraftProposalPersister(
  createDrizzleDraftLifecycleStore(),
);

export function proposeDraft(input: ProposeDraftInput) {
  return defaultDraftProposalGenerator.proposeDraft(input);
}

export function persistAcceptedDraftProposal(input: PersistAcceptedDraftProposalInput) {
  return defaultAcceptedDraftProposalPersister.persistAcceptedDraftProposal(input);
}
