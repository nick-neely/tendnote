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

const FAKE_EMBEDDING_DIMENSIONS = 64;

/** A small stable FNV-1a hash. `Math.imul` keeps the result identical across runtimes. */
function hashFeature(value: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Token features carry word overlap; padded character trigrams give nearby spelling
 * and inflection some signal. Signed feature hashing distributes both across a compact
 * vector without a model download or network call.
 */
function featuresForText(text: string): Array<{ value: string; weight: number }> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const features: Array<{ value: string; weight: number }> = [];

  for (const token of tokens) {
    features.push({ value: `token:${token}`, weight: 2 });
    const padded = `  ${token}  `;
    for (let index = 0; index <= padded.length - 3; index += 1) {
      features.push({ value: `gram:${padded.slice(index, index + 3)}`, weight: 1 });
    }
  }

  return features;
}

export function fakeVectorForText(text: string) {
  const buckets = Array.from({ length: FAKE_EMBEDDING_DIMENSIONS }, () => 0);

  for (const feature of featuresForText(text)) {
    const bucketIndex = hashFeature(feature.value, 0x9e3779b9) % buckets.length;
    const sign = hashFeature(feature.value, 0x85ebca6b) >>> 31 === 0 ? 1 : -1;
    buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + sign * feature.weight;
  }

  const magnitude = Math.hypot(...buckets) || 1;
  return buckets.map((bucket) => Number((bucket / magnitude).toFixed(6)));
}
