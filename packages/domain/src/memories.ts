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
  householdId: z.string().nullable().optional(),
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

/**
 * Fields a user may correct while reviewing a suggested memory, before saving it
 * as approved or while keeping it suggested. All optional: an empty edit is a
 * no-op, and a provided `sensitivity` is a manual override that wins over
 * defaults/classification (ADR 0056). Provenance fields (person, source record)
 * are intentionally not editable here.
 */
export const memoryReviewEditSchema = z
  .object({
    content: z.string().trim().min(1),
    memoryType: memoryTypeSchema,
    sensitivity: sensitivitySchema,
    importance: z.number().int().min(1).max(5),
  })
  .partial();

export type Memory = z.infer<typeof memorySchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type CreateMemoryInput = z.input<typeof createMemorySchema>;
export type MemoryReviewEdit = z.infer<typeof memoryReviewEditSchema>;

export function isDurableMemoryFact(memory: Pick<Memory, "status">) {
  return memory.status === "approved";
}

/**
 * Applies a review edit to a memory's mutable fields, leaving anything the edit
 * omits untouched. Pure so the override rules (manual `sensitivity` wins) can be
 * tested without a store (ADR 0056, ADR 0059).
 */
export function applyMemoryReviewEdit<
  T extends Pick<Memory, "content" | "memoryType" | "sensitivity" | "importance">,
>(memory: T, edit: MemoryReviewEdit): T {
  return {
    ...memory,
    ...(edit.content !== undefined ? { content: edit.content } : {}),
    ...(edit.memoryType !== undefined ? { memoryType: edit.memoryType } : {}),
    ...(edit.sensitivity !== undefined ? { sensitivity: edit.sensitivity } : {}),
    ...(edit.importance !== undefined ? { importance: edit.importance } : {}),
  };
}

/**
 * Canonical explicit-memory triggers. An explicit request such as "remember",
 * "save", "note", or "keep track of" creates an approved memory immediately,
 * while still keeping a source record for provenance (see ADR 0021).
 */
export const explicitMemoryTriggers = ["remember", "save", "note", "keep track of"] as const;

export type ExplicitMemoryTrigger = (typeof explicitMemoryTriggers)[number];

export type ParsedExplicitMemoryRequest = {
  isExplicitMemoryRequest: boolean;
  trigger: ExplicitMemoryTrigger | null;
  content: string;
};

// Ordered longest-first so multi-word phrasings win before their bare trigger.
// Each phrasing maps to the canonical trigger it represents.
const explicitMemoryPhrasings: ReadonlyArray<{ phrasing: string; trigger: ExplicitMemoryTrigger }> =
  [
    { phrasing: "keep track of", trigger: "keep track of" },
    { phrasing: "make a note of", trigger: "note" },
    { phrasing: "make a note that", trigger: "note" },
    { phrasing: "take a note of", trigger: "note" },
    { phrasing: "remember that", trigger: "remember" },
    { phrasing: "remember to", trigger: "remember" },
    { phrasing: "remember", trigger: "remember" },
    { phrasing: "save that", trigger: "save" },
    { phrasing: "save this", trigger: "save" },
    { phrasing: "save", trigger: "save" },
    { phrasing: "note that", trigger: "note" },
    { phrasing: "note", trigger: "note" },
  ];

const leadingSeparators = /^[\s:,.\-–—]+/;

/**
 * Deterministically classifies whether a capture is an explicit memory request
 * and, if so, extracts the durable fact by stripping the trigger phrasing. This
 * is the product rule for explicit capture; agent and web surfaces stay thin by
 * deferring to it rather than re-implementing keyword detection.
 */
export function parseExplicitMemoryRequest(text: string): ParsedExplicitMemoryRequest {
  const trimmed = text.trim();
  const withoutPlease = trimmed.replace(/^please[\s:,.\-–—]+/i, "");
  const lower = withoutPlease.toLowerCase();

  for (const { phrasing, trigger } of explicitMemoryPhrasings) {
    if (!lower.startsWith(phrasing)) {
      continue;
    }

    // Guard against trigger words embedded in longer words ("saved", "notebook").
    const remainder = lower.slice(phrasing.length);
    if (remainder.length > 0 && !leadingSeparators.test(remainder)) {
      continue;
    }

    const content = withoutPlease.slice(phrasing.length).replace(leadingSeparators, "").trim();

    return { isExplicitMemoryRequest: true, trigger, content };
  }

  return { isExplicitMemoryRequest: false, trigger: null, content: trimmed };
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
