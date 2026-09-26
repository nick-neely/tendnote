import { gateway, type LanguageModel, wrapLanguageModel } from "ai";

/** The Account Ceiling bucket a call is charged to (ADR 0246). */
export type CostCategory = "interactive" | "background" | "web_search";

type HostedModelProvider = (modelId: string) => Exclude<LanguageModel, string>;

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

/**
 * The model-call entry point (spec #591): every hosted model call gets its
 * model here. The returned model sends the gateway's zero-data-retention and
 * no-training flags, restricts routing to the one pinned provider, and tags the
 * call with its cost category. It replaces any caller-authored gateway options
 * wholesale, so no caller can loosen them or add cross-model fallbacks; other
 * providers' options pass through untouched.
 */
export function hostedModel(
  input: { modelId: string; costCategory: CostCategory },
  provider: HostedModelProvider = gateway,
) {
  const gatewayOptions = {
    zeroDataRetention: true,
    disallowPromptTraining: true,
    only: [pinnedProvider(input.modelId)],
    tags: [`cost:${input.costCategory}`],
  };

  return wrapLanguageModel({
    model: provider(input.modelId),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: { ...params.providerOptions, gateway: gatewayOptions },
      }),
    },
  });
}
