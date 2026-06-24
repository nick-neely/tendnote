import { z } from "zod";
import { confidenceSchema, privacyScopeSchema, sensitivitySchema, sourceSchema } from "./privacy";

export const memoryTypeSchema = z.enum([
  "preference",
  "life_event",
  "gift_idea",
  "boundary",
  "context",
  "other",
]);

export const memorySchema = z.object({
  id: z.string(),
  personId: z.string(),
  ownerUserId: z.string(),
  memoryType: memoryTypeSchema.default("context"),
  content: z.string().min(1),
  source: sourceSchema.default("manual"),
  sensitivity: sensitivitySchema.default("normal"),
  confidence: confidenceSchema.default("medium"),
  scope: privacyScopeSchema.default("private"),
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
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
