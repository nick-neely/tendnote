import { searchSemanticContextSchema } from "@tendnote/domain";
import type {
  EmbeddingAdapter,
  EmbeddingConfig,
  EmbeddingStore,
  SearchSemanticContextQueryInput,
} from "./types";

export function createSemanticRetrievalQueries(
  store: EmbeddingStore,
  adapter: EmbeddingAdapter,
  config: EmbeddingConfig,
) {
  return {
    async searchSemanticContext(input: SearchSemanticContextQueryInput) {
      const parsed = searchSemanticContextSchema.parse(input);
      const queryEmbedding = await adapter.embedText({
        text: parsed.query,
        model: config.model,
        version: config.version,
      });

      return store.searchSemanticContext({
        ownerUserId: input.ownerUserId,
        ...parsed,
        queryEmbedding: queryEmbedding.vector,
        embeddingModel: queryEmbedding.model,
        embeddingVersion: queryEmbedding.version,
      });
    },
  };
}
