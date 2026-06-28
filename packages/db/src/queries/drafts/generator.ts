import {
  type DraftGroundedContext,
  type DraftSourceRef,
  draftSourceRefTrustForKind,
  hasGroundedDraftContext,
  type Memory,
  type MessageDraft,
  type MessageDraftChannel,
  type MessageDraftPurpose,
  type SourceRecord,
} from "@tendnote/domain";
import type { GetPersonContextInput, PersonContextResult } from "../person-context";
import type { DraftAdapter } from "./draft-adapter";
import type { DraftLifecycleStore } from "./types";

/** Why the generator declined to create a draft, instead of inventing a weak one. */
export type DraftSkipReason = "person_not_found" | "insufficient_context" | "generation_failed";

/**
 * Outcome of a generation attempt. The generator never throws for the expected
 * refusal cases (PRD user stories #30/#31): a missing/ambiguous person, thin
 * context, or an adapter failure all return a `skipped` outcome with a reason so
 * web and Eve callers can surface a clarification instead of a misleading draft.
 */
export type GenerateDraftOutcome =
  | { status: "created"; draft: MessageDraft }
  | { status: "skipped"; reason: DraftSkipReason };

/**
 * Read-only person-context surface the generator grounds drafts from (the same
 * trust-aware retrieval the web profile and Eve use, ADR-0004/0058). The generator
 * never queries memories or source records directly, so trust and restricted-
 * content policy are applied in exactly one place.
 */
export type DraftPersonContextSource = {
  getPersonContext: (input: GetPersonContextInput) => Promise<PersonContextResult>;
};

export type DraftGeneratorOptions = {
  draftAdapter: DraftAdapter;
};

export type GenerateDraftInput = {
  ownerUserId: string;
  personId: string;
  channel?: MessageDraftChannel;
  purpose?: MessageDraftPurpose;
  // Set when the user directly asked about this person/topic, relaxing the
  // proactive restriction on restricted-sensitivity content (ADR-0058).
  directlyRequested?: boolean;
  toneInstruction?: string;
  // Explicit follow-up / brief-item entry points (PRD user stories #2/#4). Supplied
  // by the caller rather than re-fetched, so grounding stays to what was requested.
  followupContext?: { id: string; reason: string };
  briefItemContext?: { id: string; title: string; reason?: string };
};

// Source-reference labels are a snapshot for review/Eve, never a place to dump a
// whole note. Trim to keep persisted grounding compact and readable.
const MAX_LABEL_LENGTH = 200;

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

/**
 * Shared owner-scoped draft generator (PRD #75, issue #77). This is the single
 * seam web actions, Eve tools, and future brief-driven requests call thinly, so
 * drafting policy cannot fork. It resolves the person through trust-aware context,
 * gathers eligible grounding (approved memories as facts, source records as logged
 * context, suggested memories as tentative hints, plus explicit follow-up/brief
 * entry points), best-effort enriches with semantic retrieval, then calls the
 * injectable adapter, persists the draft with its source references, and writes an
 * audit entry. Restricted/dismissed/archived/pending/wrong-owner records are
 * already excluded by the person-context policy; thin or unresolved cases are
 * refused rather than drafted.
 */
export function createDraftGenerator(
  store: DraftLifecycleStore,
  personContext: DraftPersonContextSource,
  options: DraftGeneratorOptions,
) {
  return {
    async generateDraft(input: GenerateDraftInput): Promise<GenerateDraftOutcome> {
      const channel: MessageDraftChannel = input.channel ?? "text";
      const purpose: MessageDraftPurpose = input.purpose ?? "other";

      const context = await personContext.getPersonContext({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        directlyRequested: input.directlyRequested,
      });

      if (!context.person) {
        return { status: "skipped", reason: "person_not_found" };
      }

      // Grounding is drawn only from the trust-aware person context, so trust,
      // restricted-content, and owner policy are applied in exactly one place
      // (ADR-0004/0058). Drafting has no embedding dependency, so it stays useful
      // when semantic retrieval is missing, stale, or skipped (PRD user story #24).
      // Semantic-backed enrichment is deferred to a later slice and, when added,
      // must load and re-filter records through this same policy rather than
      // injecting raw hits as confirmed facts.
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

      // No invented outreach: if nothing confirmed/logged and no explicit entry
      // point grounds the draft, refuse rather than draft from a blank slate.
      if (!hasGroundedDraftContext(grounded)) {
        return { status: "skipped", reason: "insufficient_context" };
      }

      let generated: Awaited<ReturnType<DraftAdapter>>;
      try {
        generated = await options.draftAdapter(grounded);
      } catch {
        // A model/adapter outage must never persist a junk draft (PRD: no
        // live-model-dependent standard verification, fail-open boundaries).
        return { status: "skipped", reason: "generation_failed" };
      }

      if (!generated.body.trim()) {
        return { status: "skipped", reason: "generation_failed" };
      }

      const draft = await store.createDraft({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        channel,
        purpose,
        body: generated.body.trim(),
        status: "draft",
        sourceRefs,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "message_draft.generated",
        entityType: "message_draft",
        entityId: draft.id,
        metadataJson: {
          personId: input.personId,
          purpose,
          channel,
          // Whether restricted content was deliberately allowed (ADR-0058), plus the
          // exact records that informed the draft, so the audit log alone explains
          // the grounding without re-reading the draft.
          directlyRequested: input.directlyRequested === true,
          sourceRefKinds: sourceRefs.map((ref) => ref.kind),
          sourceRefIds: sourceRefs.map((ref) => ref.id),
          provenance: generated.provenance,
        },
      });

      return { status: "created", draft };
    },
  };
}

function buildSourceRefs(
  context: PersonContextResult,
  input: GenerateDraftInput,
): DraftSourceRef[] {
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
