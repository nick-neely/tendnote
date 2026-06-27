import type { EmbeddingAdapter } from "./types";

export function createFakeEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embedText(input) {
      return {
        vector: fakeVectorForText(input.text),
        model: input.model,
        version: input.version,
      };
    },
  };
}

export function fakeVectorForText(text: string) {
  const buckets = [0, 0, 0, 0];
  const normalized = text.toLowerCase();

  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const bucketIndex = index % buckets.length;
    buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + code / 255;
  }

  const magnitude = Math.hypot(...buckets) || 1;
  return buckets.map((bucket) => Number((bucket / magnitude).toFixed(6)));
}
