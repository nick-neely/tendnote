import { generateDeterministicAssetSnapshot } from "@tendnote/domain";
import { gateway, generateText } from "ai";
import { createAssetSnapshot } from "./asset-snapshots/builder";
import { createDrizzleAssetSnapshotStore } from "./asset-snapshots/drizzle-store";
import { createLlmAssetSnapshotGenerator } from "./asset-snapshots/llm-generator";
import type {
  AssetSnapshotContextStore,
  AssetSnapshotGenerator,
  GetAssetSnapshotInput,
} from "./asset-snapshots/types";
import { createDrizzleAssetLinkStore } from "./assets/drizzle-link-store";
import { createDrizzleAssetReviewLifecycleStore } from "./assets/drizzle-store";
import { createDrizzleGeneralActionStore } from "./general-actions/drizzle-store";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";

export type { CreateAssetSnapshotOptions } from "./asset-snapshots/builder";
export { createAssetSnapshot } from "./asset-snapshots/builder";
export { createDrizzleAssetSnapshotStore } from "./asset-snapshots/drizzle-store";
export { createInMemoryAssetSnapshotStore } from "./asset-snapshots/in-memory-store";
export type {
  AssetSnapshotProseModel,
  LlmAssetSnapshotGeneratorOptions,
} from "./asset-snapshots/llm-generator";
export { createLlmAssetSnapshotGenerator } from "./asset-snapshots/llm-generator";
export type * from "./asset-snapshots/types";

const drizzleGeneralActions = createDrizzleGeneralActionStore();

const defaultAssetSnapshotStore = {
  ...createDrizzleAssetReviewLifecycleStore(),
  ...createDrizzleAssetLinkStore(),
  getPerson: createDrizzleSourceRecordStore().getPerson,
  getGeneralAction: drizzleGeneralActions.getGeneralAction,
  getVisibleGeneralAction: drizzleGeneralActions.getVisibleGeneralAction,
  ...createDrizzleAssetSnapshotStore(),
} satisfies AssetSnapshotContextStore;

type AssetSnapshotGeneratorEnv = Record<string, string | undefined>;

/**
 * The default generator: an LLM when a gateway credential is present, the deterministic
 * one otherwise. Either way the builder owns the citations and the freshness — the
 * generator only picks the words.
 */
export function createDefaultAssetSnapshotGenerator(
  env: AssetSnapshotGeneratorEnv = process.env,
): AssetSnapshotGenerator {
  const modelId =
    env.TENDNOTE_SNAPSHOT_MODEL ?? env.TENDNOTE_AGENT_MODEL ?? "google/gemini-3.7-flash";
  const hasGatewayCredentials = Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);

  if (!hasGatewayCredentials) {
    return generateDeterministicAssetSnapshot;
  }

  return createLlmAssetSnapshotGenerator({
    version: `llm:${modelId}`,
    model: async ({ prompt }) => {
      const { text } = await generateText({
        model: gateway(modelId),
        system:
          "You write grounded summaries of things a user owns, for Tendnote. You " +
          "summarize only the facts you are given. You never invent, guess, or round a " +
          "model number, serial, filter size, price, or date — an invented exact value " +
          "is worse than no summary at all. Evidence is named, never asserted.",
        prompt,
      });

      return text;
    },
  });
}

const defaultAssetSnapshot = createAssetSnapshot(defaultAssetSnapshotStore, {
  generator: createDefaultAssetSnapshotGenerator(),
});

/**
 * Snapshot-backed Asset context: the cached summary plus the live, visibility-filtered
 * records it stands on. The records are always returned, so a stale or missing snapshot
 * degrades the card rather than the truth (#204).
 */
export async function getAssetSnapshot(input: GetAssetSnapshotInput) {
  return defaultAssetSnapshot.getAssetSnapshot(input);
}
