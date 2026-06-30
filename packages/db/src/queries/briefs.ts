import type { BriefCadence } from "@tendnote/domain";
import { generateDeterministicBriefSummary } from "@tendnote/domain";
import { gateway, generateText } from "ai";
import type { AcceptBriefSuggestedFollowupInput } from "./briefs/accept-followup";
import { createBriefSuggestedFollowupAcceptance } from "./briefs/accept-followup";
import {
  type BriefCalendarContextProvider,
  createCalendarBriefContextProvider,
} from "./briefs/calendar-context";
import { createDrizzleBriefLifecycleStore, createDrizzleBriefStore } from "./briefs/drizzle-store";
import type { GenerateBriefInput } from "./briefs/generator";
import { createBriefGenerator } from "./briefs/generator";
import type { BriefItemActionInput, SnoozeBriefItemInput } from "./briefs/lifecycle";
import { createBriefLifecycle } from "./briefs/lifecycle";
import type { ManualBriefInput } from "./briefs/manual";
import { createManualBriefGeneration } from "./briefs/manual";
import { type BriefSummaryAdapter, createLlmBriefSummaryAdapter } from "./briefs/summary-adapter";
import { createDefaultGoogleCalendarReader } from "./calendar";
import { runCalendarSuggestionWorkflow } from "./calendar-followups";
import { acceptSuggestedFollowup } from "./followups";
import { getRelationshipAgenda } from "./relationship-agenda";

export {
  type AcceptBriefSuggestedFollowupInput,
  type AcceptBriefSuggestedFollowupResult,
  createBriefSuggestedFollowupAcceptance,
} from "./briefs/accept-followup";
export {
  type BriefCalendarContextInput,
  type BriefCalendarContextProvider,
  type BriefCalendarHighlight,
  createCalendarBriefContextProvider,
  mapCalendarHighlights,
} from "./briefs/calendar-context";
export {
  createDrizzleBriefLifecycleStore,
  createDrizzleBriefStore,
} from "./briefs/drizzle-store";
export {
  type BriefAgendaSource,
  createBriefGenerator,
  type GenerateBriefInput,
} from "./briefs/generator";
export {
  createInMemoryBriefLifecycleStore,
  createInMemoryBriefStore,
} from "./briefs/in-memory-store";
export {
  type BriefItemActionInput,
  createBriefLifecycle,
  type SnoozeBriefItemInput,
} from "./briefs/lifecycle";
export {
  createManualBriefGeneration,
  type ManualBriefInput,
  type ManualBriefOutcome,
  type ManualBriefResult,
} from "./briefs/manual";
export {
  type BriefSummaryAdapter,
  type BriefSummaryModel,
  createLlmBriefSummaryAdapter,
  type LlmBriefSummaryAdapterOptions,
} from "./briefs/summary-adapter";
export type * from "./briefs/types";

type BriefSummaryEnv = Record<string, string | undefined>;

/**
 * Default decorative summary adapter (PRD #65, issue #73), mirroring the snapshot
 * generator's CI-safe wiring: with no AI gateway credentials it returns a
 * deterministic summary so dev and standard verification need no live model;
 * with credentials it calls the gateway model. Either way the generator treats it
 * as fail-open decoration.
 */
export function createDefaultBriefSummaryAdapter(
  env: BriefSummaryEnv = process.env,
): BriefSummaryAdapter {
  const modelId =
    env.TENDNOTE_BRIEF_SUMMARY_MODEL ?? env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5";
  const hasGatewayCredentials = Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);

  if (!hasGatewayCredentials) {
    return async (input) => generateDeterministicBriefSummary(input);
  }

  return createLlmBriefSummaryAdapter({
    version: `llm:${modelId}`,
    model: async ({ prompt }) => {
      const { text } = await generateText({ model: gateway(modelId), prompt });
      return text;
    },
  });
}

const defaultBriefSummaryAdapter = createDefaultBriefSummaryAdapter();

// Production wiring lives in the barrel (mirroring relationship-agenda.ts): the
// generator builder stays a pure DI seam, and the composed default reads the
// drizzle brief store and the drizzle relationship agenda. Schedule dispatch
// (#72) and the manual web action (#69) call this shared default so they cannot
// fork generator behavior.
// Shared Calendar brief-context provider (#112, #116): brief generation reads
// minimized highlights through the shared owner-scoped seam. Cache misses can read
// live using the Better Auth account-token bridge; missing/expired/revoked tokens
// or transient provider failures degrade to no highlights. No standalone Calendar
// sync loop is added.
const defaultCalendarBriefContext: BriefCalendarContextProvider =
  createCalendarBriefContextProvider({
    readerFor: () => createDefaultGoogleCalendarReader(),
  });

const defaultBriefGenerator = createBriefGenerator(
  createDrizzleBriefStore(),
  { getRelationshipAgenda },
  { summaryAdapter: defaultBriefSummaryAdapter, calendarContext: defaultCalendarBriefContext },
);

async function runCalendarSuggestionsBestEffort(input: { ownerUserId: string; now?: Date }) {
  try {
    await runCalendarSuggestionWorkflow(input);
  } catch {
    // Suggestion generation is schedule-shaped adjunct work (#117). Brief
    // persistence must not fail because Calendar is disconnected/unavailable or
    // because a bounded suggestion run failed.
  }
}

export async function generateBrief(input: GenerateBriefInput) {
  const brief = await defaultBriefGenerator.generateBrief(input);
  await runCalendarSuggestionsBestEffort({ ownerUserId: input.ownerUserId, now: input.now });
  return brief;
}

// Manual generate/regenerate default: the audited owner-scoped seam the web action
// (#69) calls. It wires the drizzle lifecycle store (brief persistence + audit) and
// the same default agenda + summary adapter, building the shared generator
// internally so the manual path and schedule dispatch cannot fork generator behavior.
const defaultManualBriefGeneration = createManualBriefGeneration(
  createDrizzleBriefLifecycleStore(),
  { getRelationshipAgenda },
  { summaryAdapter: defaultBriefSummaryAdapter, calendarContext: defaultCalendarBriefContext },
);

export async function generateManualBrief(input: ManualBriefInput) {
  const brief = await defaultManualBriefGeneration.generateCurrentBrief(input);
  await runCalendarSuggestionsBestEffort({ ownerUserId: input.ownerUserId, now: input.now });
  return brief;
}

// Dashboard read + item-action defaults (issue #70). One drizzle lifecycle store
// backs both the current-brief read and the owner-scoped dismiss/snooze actions, so
// the dashboard renders persisted snapshots and clears items without recomputing
// the relationship agenda.
const defaultBriefLifecycleStore = createDrizzleBriefLifecycleStore();
const defaultBriefLifecycle = createBriefLifecycle(defaultBriefLifecycleStore);

/** The owner's current (non-superseded) brief for a cadence and local date, or null. */
export function getCurrentBrief(input: {
  ownerUserId: string;
  cadence: BriefCadence;
  localDate: string;
}) {
  return defaultBriefLifecycleStore.findCurrentBrief(input);
}

export function dismissBriefItem(input: BriefItemActionInput) {
  return defaultBriefLifecycle.dismissBriefItem(input);
}

export function snoozeBriefItem(input: SnoozeBriefItemInput) {
  return defaultBriefLifecycle.snoozeBriefItem(input);
}

export function markBriefItemActed(input: BriefItemActionInput) {
  return defaultBriefLifecycle.markBriefItemActed(input);
}

// Accepting a suggested-followup brief item delegates to the existing shared
// suggested-followup review mutation (issue #71); no brief-specific follow-up
// lifecycle is introduced. The brief item is marked acted-on only after accept.
const defaultBriefSuggestedFollowupAcceptance = createBriefSuggestedFollowupAcceptance({
  getBriefItem: (input) => defaultBriefLifecycleStore.getBriefItem(input),
  markBriefItemActed: (input) => defaultBriefLifecycle.markBriefItemActed(input),
  acceptSuggestedFollowup,
});

export function acceptBriefSuggestedFollowup(input: AcceptBriefSuggestedFollowupInput) {
  return defaultBriefSuggestedFollowupAcceptance.acceptBriefSuggestedFollowup(input);
}
