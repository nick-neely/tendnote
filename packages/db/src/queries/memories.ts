import { createMemoryCapture } from "./memories/capture";
import { createDrizzleMemoryStore } from "./memories/drizzle-store";
import type { CaptureExplicitMemoryInput, PersonMemoryContextInput } from "./memories/types";

export { createMemoryCapture } from "./memories/capture";
export { createDrizzleMemoryStore } from "./memories/drizzle-store";
export { createInMemoryMemoryStore } from "./memories/in-memory-store";
export type * from "./memories/types";

const defaultMemoryStore = createDrizzleMemoryStore();
const defaultMemoryCapture = createMemoryCapture(defaultMemoryStore);

export async function captureExplicitMemory(input: CaptureExplicitMemoryInput) {
  return defaultMemoryCapture.captureExplicitMemory(input);
}

export async function listPersonMemoryContext(input: PersonMemoryContextInput) {
  return defaultMemoryCapture.listPersonMemoryContext(input);
}
