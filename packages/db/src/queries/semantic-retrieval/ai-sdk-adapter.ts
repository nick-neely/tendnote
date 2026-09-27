import { embed } from "ai";
import { hostedEmbeddingModel } from "../model-calls";
import type { EmbeddingAdapter } from "./types";

export function createAiSdkEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embedText(input) {
      const result = await embed({
        model: hostedEmbeddingModel({ modelId: input.model, costCategory: "background" }),
        value: input.text,
      });

      return {
        vector: result.embedding,
        model: input.model,
        version: input.version,
      };
    },
  };
}
