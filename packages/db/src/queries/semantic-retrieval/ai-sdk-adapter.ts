import { embed } from "ai";
import type { EmbeddingAdapter } from "./types";

export function createAiSdkEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embedText(input) {
      const result = await embed({
        model: input.model,
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
