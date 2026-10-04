import { type EffectFence, type EffectFences, effectFenceEntry } from "@tendnote/domain";

/** Effect fences without Vercel Blob, recording what was fenced for a test to read. */
export function createInMemoryEffectFences() {
  const entries = new Map<string, string>();
  let failures = 0;

  const fences: EffectFences = {
    async write(fence: EffectFence) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("Simulated fence store outage.");
      }
      const entry = effectFenceEntry(fence);
      if (!entries.has(entry.pathname)) entries.set(entry.pathname, entry.body);
    },
  };

  return {
    ...fences,
    failNextWrites(count: number) {
      failures = count;
    },
    pathnames: () => [...entries.keys()].sort(),
  };
}
