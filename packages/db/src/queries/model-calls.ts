import type { CostCategory } from "@tendnote/domain/usage-ledger";
import {
  gateway,
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapEmbeddingModel,
  wrapLanguageModel,
} from "ai";
import { type ModelUsage, recordModelUsage } from "./usage-ledger";

export type { CostCategory };

type HostedModelProvider = (modelId: string) => Exclude<LanguageModel, string>;
type HostedEmbeddingModelProvider = (
  modelId: string,
) => Parameters<typeof wrapEmbeddingModel>[0]["model"];

/**
 * The account a call is metered to. A caller that knows the owner names it;
 * Eve builds its models before any session exists, so it passes a resolver
 * the entry point reads when each call starts.
 */
type MeteredAccount = string | (() => string | null);

type HostedModelInput = { modelId: string; costCategory: CostCategory; account: MeteredAccount };

type StreamPart =
  Awaited<
    ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

type UsageLedgerWriter = (usage: ModelUsage) => Promise<void>;

type EntryPointDependencies<Provider> = {
  provider?: Provider;
  recordUsage?: UsageLedgerWriter;
};

/**
 * One gateway provider per model creator, so implicit caching stays warm and
 * the gateway can never fail over to another host. Each pinned provider has a
 * zero-retention, no-training endpoint for the models Tendnote uses.
 */
const PINNED_PROVIDER_BY_CREATOR: Record<string, string> = {
  google: "vertex",
  openai: "openai",
};

function pinnedProvider(modelId: string) {
  const provider = PINNED_PROVIDER_BY_CREATOR[modelId.split("/")[0] ?? ""];
  if (!provider) {
    throw new Error(`No pinned provider for model ${modelId}; hosted calls must name one.`);
  }
  return provider;
}

function gatewayOptions(input: HostedModelInput) {
  return {
    zeroDataRetention: true,
    disallowPromptTraining: true,
    only: [pinnedProvider(input.modelId)],
    tags: [`cost:${input.costCategory}`],
  };
}

/**
 * Pins the call's gateway options. It replaces any caller-authored gateway
 * options wholesale, so no caller can loosen them or add cross-model fallbacks;
 * other providers' options pass through untouched.
 */
function pinGatewayOptions(input: HostedModelInput) {
  const pinned = gatewayOptions(input);
  return {
    transformParams: async <P extends { providerOptions?: object }>({ params }: { params: P }) => ({
      ...params,
      providerOptions: { ...params.providerOptions, gateway: pinned },
    }),
  };
}

/** A resolver that throws counts as no account: metering must never fail the call it meters. */
function resolveAccount(account: MeteredAccount): string | null {
  if (typeof account === "string") return account;
  try {
    return account();
  } catch {
    return null;
  }
}

type Charge = {
  input: number | undefined;
  output: number | undefined;
  /** The call's provider metadata, where the gateway reports what it charged. */
  providerMetadata: unknown;
};

/**
 * What the gateway reported charging for one call, in millionths of a dollar,
 * or `null` when it reported nothing usable. The gateway knows which input was
 * a cheaper cache read; a token count alone cannot price a call.
 */
function gatewayCostMicroUsd(providerMetadata: unknown): number | null {
  const cost = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost;
  if (typeof cost !== "number" && (typeof cost !== "string" || cost.trim() === "")) return null;
  const dollars = Number(cost);
  return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 1_000_000) : null;
}

/**
 * Returns the Usage Ledger meter for one call, or `null` when the call has no
 * account. The account is resolved when the call starts, inside the caller's
 * async context, which is where Eve's session is visible.
 */
function startMeter(input: HostedModelInput, recordUsage: UsageLedgerWriter) {
  const accountId = resolveAccount(input.account);
  if (!accountId) {
    console.warn("usage-ledger: a model call has no account, so it is not metered", {
      modelId: input.modelId,
      costCategory: input.costCategory,
    });
    return null;
  }

  return (charge: Charge) => {
    const costMicroUsd = gatewayCostMicroUsd(charge.providerMetadata);
    if (costMicroUsd === null) {
      // Counted as free, so it cannot move the account toward its ceiling; the
      // Spend Breaker is what bounds a metering failure.
      console.warn("usage-ledger: the gateway reported no cost for a model call", {
        modelId: input.modelId,
        costCategory: input.costCategory,
      });
    }
    return recordUsage({
      accountId,
      modelId: input.modelId,
      costCategory: input.costCategory,
      inputTokens: charge.input ?? 0,
      outputTokens: charge.output ?? 0,
      costMicroUsd: costMicroUsd ?? 0,
    });
  };
}

/**
 * The model-call entry point (spec #591): every hosted model call gets its
 * model here. The returned model sends the gateway's zero-data-retention and
 * no-training flags, restricts routing to the one pinned provider, tags the
 * call with its cost category, and meters it, with the cost the gateway
 * reports, into the Usage Ledger once it finishes.
 * `scripts/model-call-entry-point.test.ts` fails if any other module builds a
 * model or calls one without this entry point.
 */
export function hostedModel(
  input: HostedModelInput,
  {
    provider = gateway,
    recordUsage = recordModelUsage,
  }: EntryPointDependencies<HostedModelProvider> = {},
) {
  const pinned = pinGatewayOptions(input);
  return wrapLanguageModel({
    model: provider(input.modelId),
    middleware: {
      ...pinned,
      wrapGenerate: async ({ doGenerate }) => {
        const meter = startMeter(input, recordUsage);
        const result = await doGenerate();
        await meter?.({
          input: result.usage.inputTokens.total,
          output: result.usage.outputTokens.total,
          providerMetadata: result.providerMetadata,
        });
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const meter = startMeter(input, recordUsage);
        const result = await doStream();
        if (!meter) return result;

        // A stream that is abandoned before it finishes reports no usage and
        // is not metered.
        let finished: Extract<StreamPart, { type: "finish" }> | undefined;
        const stream = result.stream.pipeThrough(
          new TransformStream<StreamPart, StreamPart>({
            transform(part, controller) {
              if (part.type === "finish") finished = part;
              controller.enqueue(part);
            },
            async flush() {
              if (!finished) return;
              await meter({
                input: finished.usage.inputTokens.total,
                output: finished.usage.outputTokens.total,
                providerMetadata: finished.providerMetadata,
              });
            },
          }),
        );
        return { ...result, stream };
      },
    },
  });
}

/** The entry point for embedding calls, with the same flags, pinning, tag, and metering. */
export function hostedEmbeddingModel(
  input: HostedModelInput,
  {
    provider = (modelId) => gateway.embeddingModel(modelId),
    recordUsage = recordModelUsage,
  }: EntryPointDependencies<HostedEmbeddingModelProvider> = {},
) {
  const pinned = pinGatewayOptions(input);
  return wrapEmbeddingModel({
    model: provider(input.modelId),
    middleware: {
      ...pinned,
      wrapEmbed: async ({ doEmbed }) => {
        const meter = startMeter(input, recordUsage);
        const result = await doEmbed();
        await meter?.({
          input: result.usage?.tokens,
          output: 0,
          providerMetadata: result.providerMetadata,
        });
        return result;
      },
    },
  });
}
