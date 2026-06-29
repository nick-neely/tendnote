import { generateDeterministicSnapshot } from "@tendnote/domain";
import { gateway, generateText } from "ai";
import type { GetPersonContextSnapshotInput, SnapshotGenerator } from "./context-snapshots/builder";
import { createPersonContextSnapshot } from "./context-snapshots/builder";
import { createDrizzleContextSnapshotStore } from "./context-snapshots/drizzle-store";
import { createLlmSnapshotGenerator } from "./context-snapshots/llm-generator";
import type { PersonContextSnapshotStore } from "./context-snapshots/types";
import { createDrizzleFollowupStore } from "./followups/drizzle-store";
import { createDrizzleMemoryStore } from "./memories/drizzle-store";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";

export type {
  CreatePersonContextSnapshotOptions,
  GetPersonContextSnapshotInput,
  PersonContextSnapshotResult,
  SnapshotGenerator,
  SnapshotReadStatus,
} from "./context-snapshots/builder";
export { createPersonContextSnapshot } from "./context-snapshots/builder";
export { createDrizzleContextSnapshotStore } from "./context-snapshots/drizzle-store";
export { createInMemoryContextSnapshotStore } from "./context-snapshots/in-memory-store";
export type {
  LlmSnapshotGeneratorOptions,
  SnapshotProseModel,
} from "./context-snapshots/llm-generator";
export { createLlmSnapshotGenerator } from "./context-snapshots/llm-generator";
export type * from "./context-snapshots/types";

const defaultPersonContextSnapshotStore = {
  ...createDrizzleMemoryStore(),
  listSourceRecordsForPersonContext:
    createDrizzleSourceRecordStore().listSourceRecordsForPersonContext,
  ...createDrizzleFollowupStore(),
  ...createDrizzleContextSnapshotStore(),
} satisfies PersonContextSnapshotStore;

type SnapshotGeneratorEnv = Record<string, string | undefined>;

export function createDefaultSnapshotGenerator(
  env: SnapshotGeneratorEnv = process.env,
): SnapshotGenerator {
  const modelId =
    env.TENDNOTE_SNAPSHOT_MODEL ?? env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5";
  const hasGatewayCredentials = Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);

  if (!hasGatewayCredentials) {
    return generateDeterministicSnapshot;
  }

  return createLlmSnapshotGenerator({
    version: `llm:${modelId}`,
    model: async ({ prompt }) => {
      const { text } = await generateText({
        model: gateway(modelId),
        system:
          "You write grounded relationship snapshots for Tendnote. You summarize only " +
          "the facts you are given and never infer, embellish, or invent feelings, " +
          "routines, backstory, or significance. Accuracy outranks warmth, and the " +
          "length must match the facts available rather than fill a quota.",
        prompt,
      });

      return text;
    },
  });
}

const defaultPersonContextSnapshot = createPersonContextSnapshot(
  defaultPersonContextSnapshotStore,
  {
    generator: createDefaultSnapshotGenerator(),
  },
);

export async function getPersonContextSnapshot(input: GetPersonContextSnapshotInput) {
  return defaultPersonContextSnapshot.getPersonContextSnapshot(input);
}
