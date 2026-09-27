import { gateway, type LanguageModel, wrapEmbeddingModel, wrapLanguageModel } from "ai";

/** The Account Ceiling bucket a call is charged to (ADR 0246). */
export type CostCategory = "interactive" | "background" | "web_search";

type HostedModelProvider = (modelId: string) => Exclude<LanguageModel, string>;
type HostedEmbeddingModelProvider = (
  modelId: string,
) => Parameters<typeof wrapEmbeddingModel>[0]["model"];
type HostedModelInput = { modelId: string; costCategory: CostCategory };

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

/**
 * The model-call entry point (spec #591): every hosted model call gets its
 * model here. The returned model sends the gateway's zero-data-retention and
 * no-training flags, restricts routing to the one pinned provider, and tags the
 * call with its cost category. `scripts/model-call-entry-point.test.ts` fails
 * if any other module builds a model or calls one without this entry point.
 */
export function hostedModel(input: HostedModelInput, provider: HostedModelProvider = gateway) {
  const middleware = pinGatewayOptions(input);
  return wrapLanguageModel({ model: provider(input.modelId), middleware });
}

/** The entry point for embedding calls, with the same flags, pinning, and tag. */
export function hostedEmbeddingModel(
  input: HostedModelInput,
  provider: HostedEmbeddingModelProvider = (modelId) => gateway.embeddingModel(modelId),
) {
  const middleware = pinGatewayOptions(input);
  return wrapEmbeddingModel({ model: provider(input.modelId), middleware });
}
