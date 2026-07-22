import { searchSavedItemsSemanticSchema, searchSemanticContextSchema } from "@tendnote/domain";
import type {
  EmbeddingAdapter,
  EmbeddingConfig,
  EmbeddingStore,
  SearchSavedItemsSemanticRequest,
  SearchSemanticContextRequest,
} from "./types";

export function createSemanticRetrievalQueries(
  store: EmbeddingStore,
  adapter: EmbeddingAdapter,
  config: EmbeddingConfig,
) {
  return {
    async searchSemanticContext(input: SearchSemanticContextRequest) {
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
    async searchSavedItemsSemantic(input: SearchSavedItemsSemanticRequest) {
      const parsed = searchSavedItemsSemanticSchema.parse(input);
      const queryEmbedding = await adapter.embedText({
        text: parsed.query,
        model: config.model,
        version: config.version,
      });
      return store.searchSavedItemsSemantic({
        ownerUserId: input.ownerUserId,
        ...parsed,
        queryEmbedding: queryEmbedding.vector,
        embeddingModel: queryEmbedding.model,
        embeddingVersion: queryEmbedding.version,
      });
    },
  };
}
