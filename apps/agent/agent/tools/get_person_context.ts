import { getPersonContextSnapshot } from "@tendnote/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe("The resolved Tendnote person to load context for. Resolve identity first."),
  includeRestricted: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the user directly asked about delicate/restricted context for this person. Defaults false, which keeps restricted content hidden. Restricted content is fetched live and never appears in the cached snapshot summary.",
    ),
});

/**
 * Thin Eve-facing wrapper over the same shared snapshot-backed read path the web
 * profile uses (`getPersonContextSnapshot`). Eve does not own snapshot
 * generation, freshness, policy filtering, or persistence — it consumes the
 * shared owner-scoped contract (PRD #11).
 *
 * The response leads with the generated `snapshot` summary as a fast orientation
 * cache, then carries the trust-aware supporting records so the model can ground
 * specific claims or drafts in them rather than the snapshot prose. The three
 * trust tiers stay separate so the model phrases each correctly; `guidance`
 * restates the rules at call time (ADR 0004, ADR 0009, ADR 0031).
 */
export default defineTool({
  description:
    "Load a person's relationship context through the shared snapshot-backed read path. `snapshot.summary` is a generated CACHE for quick orientation, NOT a source of truth — before stating specific facts or drafting a message, ground them in the supporting records. Those records come in three tiers that MUST be phrased differently: `approvedMemories` are CONFIRMED FACTS; `sourceRecords` are LOGGED CONTEXT — phrase as 'you noted' or 'you mentioned', never as established fact; `suggestedMemories` are TENTATIVE review items the user has not approved — never state them as fact. `followups` are compact reminders, not a task list. Dismissed, archived, pending, and unresolved records are already excluded. Restricted content is omitted from the snapshot and the default tiers unless the user directly asked (set includeRestricted). If `snapshot` is null the cache was unavailable; fall back to the supporting records, which are always returned.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    // The shared read path owns generation, freshness, policy, persistence, and
    // fail-open fallback. directlyRequested surfaces restricted records live in
    // the supporting tiers without ever baking them into the cached snapshot.
    const result = await getPersonContextSnapshot({
      ownerUserId,
      personId: input.personId,
      directlyRequested: input.includeRestricted ?? false,
    });

    const { context, snapshot, status } = result;

    if (!context.person) {
      return { found: false as const };
    }

    return {
      found: true as const,
      // Generated relationship snapshot — a cache to orient from, never a source
      // of truth. Null when missing/stale/failed; use the records below instead.
      snapshot:
        snapshot && status !== "fallback"
          ? {
              summary: snapshot.summary,
              generatedAt: snapshot.generatedAt.toISOString(),
              // Compact reminder context carried by the snapshot (#16).
              followups: snapshot.followups,
            }
          : null,
      // Whether the snapshot was reused, rebuilt, or unavailable (fail-open).
      snapshotStatus: status,
      person: {
        id: context.person.id,
        displayName: context.person.displayName,
        relationshipType: context.person.relationshipType,
        birthday: context.person.birthday ?? null,
        profileBlurb: context.person.profileBlurb ?? null,
      },
      // Confirmed facts — safe to state plainly.
      approvedMemories: context.approvedMemories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        sensitivity: memory.sensitivity,
        confidence: memory.confidence,
      })),
      // Logged context — phrase as "you noted" / "you mentioned", not as fact.
      sourceRecords: context.sourceRecords.map((sourceRecord) => ({
        id: sourceRecord.id,
        content: sourceRecord.content,
        sourceType: sourceRecord.sourceType,
        sensitivity: sourceRecord.sensitivity,
        capturedAt: sourceRecord.createdAt.toISOString(),
      })),
      // Tentative review items — not approved; never state as fact.
      suggestedMemories: context.suggestedMemories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        sensitivity: memory.sensitivity,
      })),
      guidance: {
        snapshot:
          "Generated cache, NOT a source of truth. Use it to orient; ground specific claims or drafts in the supporting records below.",
        approvedMemories: "Confirmed facts. State plainly.",
        sourceRecords: "Logged context. Phrase as 'you noted' or 'you mentioned', not as fact.",
        suggestedMemories: "Tentative and unapproved. Offer for review; never assert as fact.",
        followups: "Compact reminders for orientation. Do not treat as a task list.",
      },
    };
  },
});
