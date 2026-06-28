import { generateDeterministicDraft, type MessageDraftStatus } from "@tendnote/domain";
import { gateway, generateText } from "ai";
import { createLlmDraftAdapter, type DraftAdapter } from "./drafts/draft-adapter";
import { createDrizzleDraftLifecycleStore, createDrizzleDraftStore } from "./drafts/drizzle-store";
import { createDraftGenerator, type GenerateDraftInput } from "./drafts/generator";
import {
  createDraftLifecycle,
  type DraftActionInput,
  type EditDraftBodyInput,
} from "./drafts/lifecycle";
import { createDraftRegeneration } from "./drafts/regenerate";
import { getPersonContext } from "./person-context";

export {
  createLlmDraftAdapter,
  type DraftAdapter,
  type DraftModel,
  type LlmDraftAdapterOptions,
} from "./drafts/draft-adapter";
export {
  createDrizzleDraftLifecycleStore,
  createDrizzleDraftStore,
} from "./drafts/drizzle-store";
export {
  createDraftGenerator,
  type DraftGeneratorOptions,
  type DraftPersonContextSource,
  type DraftSkipReason,
  type GenerateDraftInput,
  type GenerateDraftOutcome,
} from "./drafts/generator";
export {
  createInMemoryDraftLifecycleStore,
  createInMemoryDraftStore,
} from "./drafts/in-memory-store";
export {
  createDraftLifecycle,
  type DraftActionInput,
  type EditDraftBodyInput,
} from "./drafts/lifecycle";
export { createDraftRegeneration, type DraftRegenerationDeps } from "./drafts/regenerate";
export type * from "./drafts/types";

type DraftAdapterEnv = Record<string, string | undefined>;

/**
 * Default drafting adapter (PRD #75, issue #77), mirroring the brief summary
 * adapter's CI-safe wiring: with no AI gateway credentials it returns a
 * deterministic, source-grounded draft so dev and standard verification need no
 * live model; with credentials it calls the gateway model and falls back to the
 * deterministic draft on empty output.
 */
export function createDefaultDraftAdapter(env: DraftAdapterEnv = process.env): DraftAdapter {
  const modelId =
    env.TENDNOTE_DRAFT_MODEL ?? env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5";
  const hasGatewayCredentials = Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);

  if (!hasGatewayCredentials) {
    return async (input) => generateDeterministicDraft(input);
  }

  return createLlmDraftAdapter({
    version: `llm:${modelId}`,
    model: async ({ prompt }) => {
      const { text } = await generateText({ model: gateway(modelId), prompt });
      return text;
    },
  });
}

const defaultDraftAdapter = createDefaultDraftAdapter();

// Production wiring lives in the barrel (mirroring briefs): the generator builder
// stays a pure DI seam, and the composed default reads the drizzle draft lifecycle
// store and the shared trust-aware person context. Web actions (#79) and Eve tools
// (#80) call this shared default so they cannot fork generator behavior.
const defaultDraftGenerator = createDraftGenerator(
  createDrizzleDraftLifecycleStore(),
  { getPersonContext },
  { draftAdapter: defaultDraftAdapter },
);

export function generateDraft(input: GenerateDraftInput) {
  return defaultDraftGenerator.generateDraft(input);
}

// Default owner-scoped draft reads + lifecycle (issues #76/#78). One drizzle
// lifecycle store backs reads and the audited dismiss/approve/sent-manually/edit
// actions, so the review surface reads persisted drafts and mutates them through
// the shared lifecycle without forking draft storage.
const defaultDraftLifecycleStore = createDrizzleDraftLifecycleStore();
const defaultDraftStore = createDrizzleDraftStore();
const defaultDraftLifecycle = createDraftLifecycle(defaultDraftLifecycleStore);

/** A single owner-scoped draft (with its persisted source references), or null. */
export function getDraft(input: { ownerUserId: string; draftId: string }) {
  return defaultDraftStore.getDraft(input);
}

/** The owner's drafts for a person, newest first, optionally filtered by status. */
export function listDraftsForPerson(input: {
  ownerUserId: string;
  personId: string;
  statuses?: MessageDraftStatus[];
}) {
  return defaultDraftStore.listDraftsForPerson(input);
}

export function approveDraft(input: DraftActionInput) {
  return defaultDraftLifecycle.approveDraft(input);
}

export function dismissDraft(input: DraftActionInput) {
  return defaultDraftLifecycle.dismissDraft(input);
}

export function markDraftSentManually(input: DraftActionInput) {
  return defaultDraftLifecycle.markDraftSentManually(input);
}

export function editDraftBody(input: EditDraftBodyInput) {
  return defaultDraftLifecycle.editDraftBody(input);
}

// Explicit regeneration reuses the shared lifecycle store and the default
// generator, so it cannot fork generation or audit behavior (issue #78).
const defaultDraftRegeneration = createDraftRegeneration({
  store: defaultDraftLifecycleStore,
  generateDraft,
});

export function regenerateDraft(input: DraftActionInput) {
  return defaultDraftRegeneration.regenerateDraft(input);
}
