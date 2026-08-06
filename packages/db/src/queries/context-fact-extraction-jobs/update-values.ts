import type { UpdateContextFactExtractionJobInput } from "./types";

export function contextFactExtractionJobUpdateValues(input: UpdateContextFactExtractionJobInput) {
  return {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(Object.hasOwn(input, "message") ? { message: input.message } : {}),
    ...(Object.hasOwn(input, "claimToken") ? { claimToken: input.claimToken } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
    ...(Object.hasOwn(input, "claimedAt") ? { claimedAt: input.claimedAt } : {}),
    ...(Object.hasOwn(input, "completedAt") ? { completedAt: input.completedAt } : {}),
    updatedAt: new Date(),
  };
}
