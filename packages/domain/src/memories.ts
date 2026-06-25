import { z } from "zod";
import { confidenceSchema, privacyScopeSchema, sensitivitySchema } from "./privacy";

export const memoryTypeSchema = z.enum([
  "preference",
  "life_event",
  "gift_idea",
  "boundary",
  "context",
  "other",
]);

export const memoryStatusSchema = z.enum(["suggested", "approved", "dismissed", "archived"]);

export const memorySchema = z.object({
  id: z.string(),
  personId: z.string(),
  ownerUserId: z.string(),
  sourceRecordId: z.string().min(1),
  memoryType: memoryTypeSchema.default("context"),
  content: z.string().min(1),
  status: memoryStatusSchema.default("suggested"),
  importance: z.number().int().min(1).max(5).default(3),
  sensitivity: sensitivitySchema.default("normal"),
  confidence: confidenceSchema.default("medium"),
  scope: privacyScopeSchema.default("private"),
  approvedAt: z.date().nullable().optional(),
  dismissedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createMemorySchema = memorySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Memory = z.infer<typeof memorySchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

export function isDurableMemoryFact(memory: Pick<Memory, "status">) {
  return memory.status === "approved";
}

export function canUseMemoryProactively(
  memory: Pick<Memory, "status" | "sensitivity">,
  input: { directlyRequested?: boolean } = {},
) {
  if (memory.status !== "approved") {
    return false;
  }

  return memory.sensitivity !== "restricted" || input.directlyRequested === true;
}
