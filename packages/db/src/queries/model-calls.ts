import type { CostCategory } from "@tendnote/domain/usage-ledger";
import {
  gateway,
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapEmbeddingModel,
  wrapLanguageModel,
} from "ai";
import { readEveOverFairUseBudget } from "./usage-bounds";
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

/**
 * An interactive model may name a Fallback Model: the cheaper model its calls
 * run on while the account is over its Fair-Use Budget. Only interactive Eve
 * has one (spec #591).
 */
type HostedLanguageModelInput =
  | (HostedModelInput & { costCategory: "interactive"; fallbackModelId?: string })
  | (HostedModelInput & { costCategory: Exclude<CostCategory, "interactive"> });

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

type LanguageEntryPointDependencies = EntryPointDependencies<HostedModelProvider> & {
  /** Whether an account is over its interactive Fair-Use Budget, which picks the Fallback Model. */
  overFairUseBudget?: (accountId: string) => Promise<boolean>;
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
 * reports, into the Usage Ledger once it finishes. A model with a Fallback
 * Model also chooses, per call, which of the two the call runs on.
 * `scripts/model-call-entry-point.test.ts` fails if any other module builds a
 * model or calls one without this entry point.
 */
export function hostedModel(
  input: HostedLanguageModelInput,
  {
    provider = gateway,
    recordUsage = recordModelUsage,
    overFairUseBudget = (accountId) => readEveOverFairUseBudget({ userId: accountId }),
  }: LanguageEntryPointDependencies = {},
) {
  const production = meteredModel(input, { provider, recordUsage });
  if (input.costCategory !== "interactive" || !input.fallbackModelId) return production;

  const fallback = meteredModel(
    { ...input, modelId: input.fallbackModelId },
    {
      provider,
      recordUsage,
    },
  );
  const modelForCall = async () =>
    (await runsOnFallback(input, overFairUseBudget)) ? fallback : production;

  // Each delegate applies its own pinning and metering, so the Fallback Model's
  // calls are routed to its own provider and metered under its own id.
  return wrapLanguageModel({
    model: production,
    middleware: {
      wrapGenerate: async ({ params }) => (await modelForCall()).doGenerate(params),
      wrapStream: async ({ params }) => (await modelForCall()).doStream(params),
    },
  });
}

/**
 * Whether this call runs on the Fallback Model: its account is over its
 * interactive Fair-Use Budget, read when the call starts so a turn switches at
 * the step that crosses it. Past the Account Ceiling it still is, so a turn
 * already running there finishes on the cheaper model. When the read fails the
 * call stays on the production model: the Fallback Model is never silent, and
 * Eve's door still enforces the ceiling on its own read.
 */
async function runsOnFallback(
  input: HostedModelInput,
  overFairUseBudget: (accountId: string) => Promise<boolean>,
) {
  const accountId = resolveAccount(input.account);
  if (!accountId) return false;
  try {
    return await overFairUseBudget(accountId);
  } catch {
    console.warn("usage: could not read usage to choose the Fallback Model", {
      modelId: input.modelId,
    });
    return false;
  }
}

/** One pinned, metered model: the production model or the Fallback Model. */
function meteredModel(
  input: HostedModelInput,
  { provider, recordUsage }: Required<EntryPointDependencies<HostedModelProvider>>,
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
