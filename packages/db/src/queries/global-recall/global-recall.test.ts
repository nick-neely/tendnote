import {
  contextFactSchema,
  type HouseholdMembership,
  type Memory,
  type Person,
  type SourceRecord,
  searchAssetsSchema,
  searchRelationshipContextSchema,
  searchSavedItemsSemanticSchema,
  searchSemanticContextSchema,
  toContextFactView,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import type { HouseholdContextExactResult, SelfContextExactResult } from "../context-facts/types";
import { createInMemoryRelationshipContextSearchStore } from "../relationship-context-search/in-memory-store";
import { createRelationshipContextSearchQueries } from "../relationship-context-search/queries";
import { createGlobalRecall } from "./queries";
import type { GlobalRecallDependencies } from "./types";

const OWNER = "owner-1";
const HOUSEHOLD = "household-1";

function assetOutcome(
  results: Awaited<ReturnType<GlobalRecallDependencies["searchAssets"]>>["results"],
  semanticAvailable = true,
) {
  return { results, semanticAvailable };
}

/** A semantic candidate at a chosen similarity, for exercising the Related floor. */
function relatedMemory(similarity: number, recordId = "memory-weak") {
  return {
    recordKind: "memory" as const,
    recordId,
    visibilityChoice: "only_me" as const,
    visibilityLabel: "Only me",
    relatedPersonId: "person-1",
    relatedPersonDisplayName: "Priya",
    snippet: "A loosely related detail",
    similarity,
    trustLevel: "confirmed_fact" as const,
    sensitivity: "normal" as const,
    sourceRefs: [{ kind: "memory" as const, id: recordId }],
    routing: { personId: "person-1", recordKind: "memory" as const, recordId },
    generalAction: null,
  };
}

/** A semantic Action candidate - the same relationship read, a different family. */
function relatedGeneralAction(similarity: number, recordId = "action-weak") {
  return {
    ...relatedMemory(similarity, recordId),
    recordKind: "general_action" as const,
    relatedPersonId: null,
    relatedPersonDisplayName: null,
    trustLevel: "action_item" as const,
    sourceRefs: [{ kind: "general_action" as const, id: recordId }],
    routing: { personId: null, recordKind: "general_action" as const, recordId },
    generalAction: {
      status: "open" as const,
      isRoutine: false,
      isSuggested: false,
      areaId: null,
    },
  };
}

/**
 * A logged note with nobody behind it. The relationship normalizer routes context
 * through its person, so this candidate has no record to become at any similarity.
 */
function relatedOrphanSourceRecord(similarity: number, recordId = "note-orphan") {
  return {
    ...relatedMemory(similarity, recordId),
    recordKind: "source_record" as const,
    relatedPersonId: null,
    relatedPersonDisplayName: null,
    trustLevel: "logged_context" as const,
    sourceRefs: [{ kind: "source_record" as const, id: recordId }],
    routing: { personId: null, recordKind: "source_record" as const, recordId },
  };
}

function exactPerson(recordId = "person-1", label = "Priya Shah") {
  return {
    recordKind: "person" as const,
    recordId,
    visibilityChoice: null,
    visibilityLabel: null,
    relatedPersonId: recordId,
    relatedPersonDisplayName: label,
    label,
    snippet: label,
    matchedFields: ["display name"],
    rank: 0.9,
    trustLevel: "identity_reference" as const,
    sensitivity: "normal" as const,
    generalAction: null,
  };
}

function exactSelfContext(
  id = "context-fact-1",
  content = "I run a software consultancy.",
  sensitivity: "normal" | "restricted" = "normal",
): SelfContextExactResult {
  const now = new Date("2026-08-02T12:00:00.000Z");
  return {
    fact: {
      ...contextFactSchema.parse({
        id,
        subject: { kind: "self", userId: OWNER },
        category: "work",
        content,
        lifecycle: "active",
        sensitivity,
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: OWNER,
        lastActorUserId: OWNER,
        reviewedAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      category: "work",
    },
    matchedFields: ["content"],
    rank: 5,
  };
}

/**
 * A household fact in the shape the household query already answers with: a
 * rendered view, not a raw record. The proof that decides whether the caller may
 * see it at all lives inside that query, so the stubs below stand in for it the
 * only way this seam can observe it - by answering for one member and nobody
 * else.
 */
function exactHouseholdContext(
  id = "household-fact-1",
  content = "Two adults and one child live here.",
  sensitivity: "normal" | "restricted" = "normal",
): HouseholdContextExactResult {
  const now = new Date("2026-08-02T12:00:00.000Z");
  return {
    fact: toContextFactView(
      contextFactSchema.parse({
        id,
        subject: { kind: "household", householdId: HOUSEHOLD },
        // Composition is a household-only category, so a household result that
        // could not carry it would be unmodellable for the household's most
        // characteristic statement.
        category: "composition",
        content,
        lifecycle: "active",
        sensitivity,
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: OWNER,
        lastActorUserId: OWNER,
        reviewedAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ),
    matchedFields: ["content"],
    rank: 5,
  };
}

const emptyDependencies = {
  searchSelfContextExact: async () => [],
  searchHouseholdContextExact: async () => [],
  searchRelationshipExact: async () => [],
  searchRelationshipRelated: async () => [],
  searchAssets: async () => assetOutcome([]),
  searchSavedItemsExact: async () => [],
  searchSavedItemsRelated: async () => [],
  searchGiftPlans: async () => [],
  listFollowups: async () => [],
  readCalendar: async () => ({ connected: false, result: null }),
} satisfies GlobalRecallDependencies;

describe("Global Recall", () => {
  it("returns exact Self Context with canonical correction metadata and no semantic retrieval", async () => {
    const searchRelationshipRelated = vi.fn().mockResolvedValue([]);
    const searchSelfContextExact = vi
      .fn()
      .mockImplementation(async (input) =>
        input.callerUserId === OWNER ? [exactSelfContext()] : [],
      );
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipRelated,
      searchSelfContextExact,
    });

    const result = await recall.search({
      ownerUserId: OWNER,
      query: "software consultancy",
      family: "self_context",
    });

    expect(result).toMatchObject({
      results: [
        {
          family: "self_context",
          canonical: { kind: "context_fact", id: "context-fact-1" },
          label: "I run a software consultancy.",
          supportingText: "Work",
          lifecycle: "active",
          trust: "self_context",
          sensitivity: "normal",
          visibility: { choice: "only_me", label: "Only me" },
          grounding: [{ kind: "context_fact", id: "context-fact-1" }],
          href: "/account/about-you#context-fact-context-fact-1",
          details: {
            content: "I run a software consultancy.",
            category: "work",
            categoryLabel: "Work",
            provenance: { channel: "account", origin: "direct" },
          },
        },
      ],
      limitations: [],
    });
    expect(searchSelfContextExact).toHaveBeenCalledWith({
      callerUserId: OWNER,
      query: "software consultancy",
      directlyRequested: false,
      includeArchived: false,
      limit: 20,
    });
    await expect(
      recall.search({
        ownerUserId: "owner-2",
        query: "software consultancy",
        family: "self_context",
      }),
    ).resolves.toMatchObject({ results: [] });
    expect(searchRelationshipRelated).not.toHaveBeenCalled();
  });

  it("returns an active member's Household Context under the household's own audience", async () => {
    const searchHouseholdContextExact = vi
      .fn()
      .mockImplementation(async (input) =>
        input.callerUserId === OWNER ? [exactHouseholdContext()] : [],
      );
    const recall = createGlobalRecall({ ...emptyDependencies, searchHouseholdContextExact });

    const result = await recall.search({
      ownerUserId: OWNER,
      query: "one child",
      family: "household_context",
    });

    expect(result).toMatchObject({
      results: [
        {
          family: "household_context",
          canonical: { kind: "context_fact", id: "household-fact-1" },
          label: "Two adults and one child live here.",
          supportingText: "Composition",
          lifecycle: "active",
          trust: "household_context",
          sensitivity: "normal",
          visibility: { choice: "whole_household", label: "Whole household" },
          grounding: [{ kind: "context_fact", id: "household-fact-1" }],
          href: "/account/household/context#household-context-fact-household-fact-1",
          match: { kind: "exact", reason: "Matched Household Context content" },
          details: {
            content: "Two adults and one child live here.",
            category: "composition",
            categoryLabel: "Composition",
            provenance: { channel: "account", origin: "direct" },
          },
        },
      ],
      limitations: [],
    });
    // A member of no household, or of a different one, is answered by the same
    // query with nothing - there is no separate "not a member" outcome to leak.
    await expect(
      recall.search({
        ownerUserId: "outsider-1",
        query: "one child",
        family: "household_context",
      }),
    ).resolves.toMatchObject({ results: [] });
  });

  it("reaches restricted Household Context only on a direct request", async () => {
    const searchHouseholdContextExact = vi
      .fn()
      .mockImplementation(async (input: { directlyRequested: boolean }) =>
        input.directlyRequested
          ? [
              exactHouseholdContext(
                "household-fact-restricted",
                "We use a shared therapy fund.",
                "restricted",
              ),
            ]
          : [],
      );
    const recall = createGlobalRecall({ ...emptyDependencies, searchHouseholdContextExact });

    const ambient = await recall.search({
      ownerUserId: OWNER,
      query: "therapy fund",
      family: "household_context",
    });
    const revealed = await recall.search({
      ownerUserId: OWNER,
      query: "therapy fund",
      family: "household_context",
      includeRestricted: true,
    });

    expect(ambient.results).toEqual([]);
    expect(revealed.results.map((entry) => entry.canonical.id)).toEqual([
      "household-fact-restricted",
    ]);
    expect(
      searchHouseholdContextExact.mock.calls.map(([input]) => input.directlyRequested),
    ).toEqual([false, true]);
  });

  /**
   * Archived Household Context is a statement the household took down together,
   * so "Include archived" - a control one member ticks for their own history -
   * must not put it back in front of them. The seam enforces that by never
   * offering the household read an archived parameter at all.
   */
  it("never widens the Household Context read to archived history", async () => {
    const searchHouseholdContextExact = vi.fn().mockResolvedValue([]);
    const recall = createGlobalRecall({ ...emptyDependencies, searchHouseholdContextExact });

    await recall.search({
      ownerUserId: OWNER,
      query: "spare key",
      family: "household_context",
      includeArchived: true,
    });

    expect(searchHouseholdContextExact).toHaveBeenCalledWith({
      callerUserId: OWNER,
      query: "spare key",
      directlyRequested: false,
      limit: 20,
    });
  });

  it("keeps a Self and a Household fact with the same words as two separate answers", async () => {
    const sameWords = "We are hosting family in August.";
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchSelfContextExact: async () => [exactSelfContext("self-fact-1", sameWords)],
      searchHouseholdContextExact: async () => [
        exactHouseholdContext("household-fact-1", sameWords),
      ],
    });

    const both = await recall.search({ ownerUserId: OWNER, query: "hosting family" });
    const selfOnly = await recall.search({
      ownerUserId: OWNER,
      query: "hosting family",
      family: "self_context",
    });
    const householdOnly = await recall.search({
      ownerUserId: OWNER,
      query: "hosting family",
      family: "household_context",
    });

    expect(
      both.results.map((entry) => [entry.family, entry.canonical.id, entry.visibility]),
    ).toEqual([
      ["self_context", "self-fact-1", { choice: "only_me", label: "Only me" }],
      [
        "household_context",
        "household-fact-1",
        { choice: "whole_household", label: "Whole household" },
      ],
    ]);
    expect(selfOnly.results.map((entry) => entry.family)).toEqual(["self_context"]);
    expect(householdOnly.results.map((entry) => entry.family)).toEqual(["household_context"]);
  });

  it("reports an unavailable Household Context read without silencing the rest", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchHouseholdContextExact: async () => {
        throw new Error("household context unavailable");
      },
      searchSelfContextExact: async () => [exactSelfContext()],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "software consultancy" });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["context-fact-1"]);
    expect(result.limitations).toEqual([
      {
        source: "household_context",
        message: "Household Context results are temporarily unavailable.",
      },
    ]);
  });

  it("uses one candidate bound accepted by every typed retrieval dependency", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async (input) => {
        searchRelationshipContextSchema.parse(input);
        return [];
      },
      searchRelationshipRelated: async (input) => {
        searchSemanticContextSchema.parse(input);
        return [];
      },
      searchAssets: async (input) => {
        searchAssetsSchema.parse(input);
        return assetOutcome([]);
      },
      searchSavedItemsRelated: async (input) => {
        searchSavedItemsSemanticSchema.parse(input);
        return [];
      },
    });

    await expect(
      recall.search({ ownerUserId: OWNER, query: "refrigerator filter" }),
    ).resolves.toMatchObject({ limitations: [] });
  });

  it("only requests restricted context after an explicit reveal, family target, and named query", async () => {
    const searchRelationshipExact = vi.fn().mockResolvedValue([]);
    const recall = createGlobalRecall({ ...emptyDependencies, searchRelationshipExact });

    await recall.search({
      ownerUserId: OWNER,
      query: "medical",
      includeRestricted: true,
      family: "people",
    });
    await recall.search({
      ownerUserId: OWNER,
      query: "medical history",
      includeRestricted: true,
      family: "people",
    });

    await expect(
      recall.search({
        ownerUserId: OWNER,
        query: "medical history",
        includeRestricted: true,
        family: "all",
      }),
      // The refusal names the field to set and the value that is wrong, because for the
      // model-facing copy of this schema that message is the only instruction a
      // rejected caller reads.
    ).rejects.toThrow(/Set `family` to one specific record family/);

    expect(searchRelationshipExact.mock.calls.map(([input]) => input.directlyRequested)).toEqual([
      false,
      true,
    ]);
  });

  it("does not couple a Related-only request to Exact retrieval or Exact failure", async () => {
    const searchRelationshipExact = vi.fn().mockRejectedValue(new Error("exact unavailable"));
    const searchRelationshipRelated = vi.fn().mockResolvedValue([
      {
        recordKind: "memory" as const,
        recordId: "memory-related",
        visibilityChoice: "only_me" as const,
        visibilityLabel: "Only me",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Priya",
        snippet: "Priya mentioned the refrigerator filter",
        similarity: 0.81,
        trustLevel: "confirmed_fact" as const,
        sensitivity: "normal" as const,
        sourceRefs: [{ kind: "memory" as const, id: "memory-related" }],
        routing: {
          personId: "person-1",
          recordKind: "memory" as const,
          recordId: "memory-related",
        },
        generalAction: null,
      },
    ]);
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact,
      searchRelationshipRelated,
    });

    const result = await recall.search({
      ownerUserId: OWNER,
      query: "fridge filter",
      family: "people",
      matchKinds: ["related"],
    });

    expect(searchRelationshipExact).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.match.kind).toBe("related");
    expect(result.limitations).toEqual([]);
  });

  it("keeps an exact canonical record ahead of Related results and removes its semantic duplicate", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [
        {
          recordKind: "general_action" as const,
          recordId: "action-1",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          label: "Replace refrigerator filter",
          snippet: "Replace refrigerator filter",
          matchedFields: ["title"],
          rank: 0.9,
          trustLevel: "action_item" as const,
          sensitivity: "normal" as const,
          generalAction: {
            status: "open" as const,
            isRoutine: false,
            isSuggested: false,
            areaId: null,
          },
        },
      ],
      searchRelationshipRelated: async () => [
        {
          recordKind: "general_action" as const,
          recordId: "action-1",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          snippet: "Replace refrigerator filter",
          similarity: 0.91,
          trustLevel: "action_item" as const,
          sensitivity: "normal" as const,
          sourceRefs: [{ kind: "general_action" as const, id: "action-1" }],
          routing: {
            personId: null,
            recordKind: "general_action" as const,
            recordId: "action-1",
          },
          generalAction: {
            status: "open" as const,
            isRoutine: false,
            isSuggested: false,
            areaId: null,
          },
        },
        {
          recordKind: "memory" as const,
          recordId: "memory-1",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Priya",
          snippet: "Priya prefers oat milk",
          similarity: 0.78,
          trustLevel: "confirmed_fact" as const,
          sensitivity: "normal" as const,
          sourceRefs: [{ kind: "memory" as const, id: "memory-1" }],
          routing: {
            personId: "person-1",
            recordKind: "memory" as const,
            recordId: "memory-1",
          },
          generalAction: null,
        },
      ],
      searchAssets: async () => assetOutcome([]),
      searchSavedItemsExact: async () => [],
      searchSavedItemsRelated: async () => [],
      listFollowups: async () => [],
      readCalendar: async () => ({ connected: false, result: null }),
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });

    expect(
      result.results.map((entry) => ({
        family: entry.family,
        canonical: entry.canonical,
        matchKind: entry.match.kind,
        href: entry.href,
      })),
    ).toEqual([
      {
        family: "general_action",
        canonical: { kind: "general_action", id: "action-1" },
        matchKind: "exact",
        href: "/actions#action-action-1",
      },
      {
        family: "relationship_context",
        canonical: { kind: "memory", id: "memory-1" },
        matchKind: "related",
        href: "/people/person-1#memory-memory-1",
      },
    ]);
  });

  it("includes terminal Actions only when archived history is requested", async () => {
    const searchRelationshipExact: GlobalRecallDependencies["searchRelationshipExact"] = async (
      input,
    ) =>
      input.includeArchived
        ? [
            {
              recordKind: "general_action",
              recordId: "action-completed",
              visibilityChoice: "only_me",
              visibilityLabel: "Only me",
              relatedPersonId: null,
              relatedPersonDisplayName: null,
              label: "Replace refrigerator filter",
              snippet: "Replace refrigerator filter",
              matchedFields: ["title"],
              rank: 0.9,
              trustLevel: "action_item",
              sensitivity: "normal",
              generalAction: {
                status: "completed",
                isRoutine: false,
                isSuggested: false,
                areaId: null,
              },
            },
          ]
        : [];
    const recall = createGlobalRecall({ ...emptyDependencies, searchRelationshipExact });

    const active = await recall.search({
      ownerUserId: OWNER,
      query: "refrigerator filter",
      family: "actions",
    });
    const history = await recall.search({
      ownerUserId: OWNER,
      query: "refrigerator filter",
      family: "actions",
      includeArchived: true,
    });

    expect(active.results).toEqual([]);
    expect(history.results[0]).toMatchObject({
      canonical: { kind: "general_action", id: "action-completed" },
      lifecycle: "completed",
    });
  });

  it("names no audience on a household-native Asset", async () => {
    // A recall row reports the audience someone chose. Nobody chose to share the
    // household's own refrigerator with the household, so there is none to report
    // and the field takes its absent shape rather than a "Whole household" chip
    // the record never earned (ADR 0214).
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchAssets: async () =>
        assetOutcome([
          {
            recordKind: "asset" as const,
            recordId: "asset-1",
            assetId: "asset-1",
            assetName: "Kitchen refrigerator",
            assetKind: "appliance" as const,
            assetStatus: "active" as const,
            ownership: "household_native" as const,
            label: "Kitchen refrigerator",
            snippet: "Kitchen refrigerator",
            matchedFields: ["name"],
            value: null,
            trustLevel: "asset_anchor" as const,
            visibilityChoice: "whole_household" as const,
            visibilityLabel: "Whole household",
            citations: [{ kind: "asset" as const, id: "asset-1" }],
            matchKinds: ["exact" as const],
            score: 0.9,
          },
        ]),
    });

    const { results } = await recall.search({ ownerUserId: OWNER, query: "refrigerator" });

    expect(results).toHaveLength(1);
    expect(results[0]?.visibility).toBeNull();
  });

  it("returns Asset Memories canonically while evidence only grounds its parent Asset", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchAssets: async () =>
        assetOutcome([
          {
            recordKind: "asset_memory" as const,
            recordId: "asset-memory-1",
            assetId: "asset-1",
            assetName: "Kitchen refrigerator",
            assetKind: "appliance" as const,
            assetStatus: "active" as const,
            ownership: "member_owned" as const,
            label: "Filter model",
            snippet: "Filter model: EDR4RXD1",
            matchedFields: ["value"],
            value: { type: "text" as const, text: "EDR4RXD1" },
            trustLevel: "asset_fact" as const,
            visibilityChoice: "only_me" as const,
            visibilityLabel: "Only me",
            citations: [
              { kind: "asset_memory" as const, id: "asset-memory-1" },
              { kind: "asset" as const, id: "asset-1" },
            ],
            matchKinds: ["structured" as const, "semantic" as const],
            score: 0.96,
          },
          {
            recordKind: "asset_evidence" as const,
            recordId: "evidence-1",
            assetId: "asset-2",
            assetName: "Garage refrigerator",
            assetKind: "appliance" as const,
            assetStatus: "active" as const,
            ownership: "member_owned" as const,
            label: "Filter receipt",
            snippet: "Replacement water filter receipt",
            matchedFields: ["label"],
            value: null,
            trustLevel: "asset_evidence" as const,
            visibilityChoice: "only_me" as const,
            visibilityLabel: "Only me",
            citations: [
              { kind: "asset_evidence" as const, id: "evidence-1" },
              { kind: "asset" as const, id: "asset-2" },
            ],
            matchKinds: ["semantic" as const],
            score: 0.71,
          },
        ]),
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "water filter" });

    expect(
      result.results.map((entry) => ({
        family: entry.family,
        canonical: entry.canonical,
        matchKind: entry.match.kind,
        grounding: entry.grounding,
        href: entry.href,
      })),
    ).toEqual([
      {
        family: "asset_memory",
        canonical: { kind: "asset_memory", id: "asset-memory-1" },
        matchKind: "exact",
        grounding: [
          { kind: "asset_memory", id: "asset-memory-1" },
          { kind: "asset", id: "asset-1" },
        ],
        href: "/assets/asset-1#asset-memory-asset-memory-1",
      },
      {
        family: "asset",
        canonical: { kind: "asset", id: "asset-2" },
        matchKind: "related",
        grounding: [
          { kind: "asset_evidence", id: "evidence-1" },
          { kind: "asset", id: "asset-2" },
        ],
        href: "/assets/asset-2",
      },
    ]);
  });

  it("deduplicates Saved Items and returns archived history only when requested", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchSavedItemsExact: async () => [
        {
          id: "saved-1",
          ownerUserId: OWNER,
          ownership: "member_owned" as const,
          version: 1,
          kind: "note" as const,
          title: "Filter measurements",
          content: "Measure the refrigerator filter opening",
          url: null,
          status: "active" as const,
          bringBackAt: null,
          bringBackTimeSemantics: "date_only" as const,
          sourceRecordId: "source-1",
          scope: "private" as const,
          householdId: null,
          resolvedAt: null,
          resolutionReason: null,
          createdByUserId: OWNER,
          lastActorUserId: OWNER,
          createdAt: now,
          updatedAt: now,
          sharedWithUserIds: [],
          householdName: null,
          outcomes: [],
        },
      ],
      searchSavedItemsRelated: async () => [
        {
          savedItemId: "saved-1",
          title: "Filter measurements",
          snippet: "Measure the refrigerator filter opening",
          similarity: 0.86,
          status: "active" as const,
          scope: "private" as const,
        },
        {
          savedItemId: "saved-archived",
          title: "Old filter question",
          snippet: "Which filter did the old refrigerator use?",
          similarity: 0.74,
          status: "archived" as const,
          scope: "private" as const,
        },
      ],
    });

    const active = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });
    const withHistory = await recall.search({
      ownerUserId: OWNER,
      query: "refrigerator filter",
      includeArchived: true,
    });

    expect(active.results.map((entry) => [entry.canonical.id, entry.match.kind])).toEqual([
      ["saved-1", "exact"],
    ]);
    expect(active.results[0]?.href).toBe("/saved-items#saved-item-saved-1");
    expect(withHistory.results.map((entry) => [entry.canonical.id, entry.match.kind])).toEqual([
      ["saved-1", "exact"],
      ["saved-archived", "related"],
    ]);
  });

  it("uses person-linked Source Records as grounding without exposing raw records as a family", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [
        {
          recordKind: "source_record" as const,
          recordId: "source-1",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Priya",
          label: "Imported note",
          snippet: "You noted Priya installed the refrigerator filter",
          matchedFields: ["content"],
          rank: 0.95,
          trustLevel: "logged_context" as const,
          sensitivity: "normal" as const,
          generalAction: null,
        },
        {
          recordKind: "person" as const,
          recordId: "person-1",
          visibilityChoice: null,
          visibilityLabel: null,
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Priya",
          label: "Priya",
          snippet: "Priya",
          matchedFields: ["display_name"],
          rank: 0.8,
          trustLevel: "identity_reference" as const,
          sensitivity: "normal" as const,
          generalAction: null,
        },
        {
          recordKind: "source_record" as const,
          recordId: "personless-source",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          label: "Unresolved note",
          snippet: "Someone mentioned another filter",
          matchedFields: ["content"],
          rank: 0.7,
          trustLevel: "logged_context" as const,
          sensitivity: "normal" as const,
          generalAction: null,
        },
        {
          recordKind: "person" as const,
          recordId: "person-2",
          visibilityChoice: null,
          visibilityLabel: null,
          relatedPersonId: "person-2",
          relatedPersonDisplayName: "Mara",
          label: "Mara",
          snippet: "Mara",
          matchedFields: ["display_name"],
          rank: 0.6,
          trustLevel: "identity_reference" as const,
          sensitivity: "normal" as const,
          generalAction: null,
        },
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });

    expect(
      result.results.map((entry) => ({
        family: entry.family,
        label: entry.label,
        canonical: entry.canonical,
        grounding: entry.grounding,
      })),
    ).toEqual([
      {
        family: "relationship_context",
        label: "Priya",
        canonical: { kind: "person", id: "person-1" },
        grounding: [{ kind: "source_record", id: "source-1" }],
      },
      {
        family: "person",
        label: "Mara",
        canonical: { kind: "person", id: "person-2" },
        grounding: [{ kind: "person", id: "person-2" }],
      },
    ]);
  });

  it("finds visible Follow-Ups by person or reason and keeps archived reminders opt-in", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const followup = (input: { id: string; reason: string; status: "open" | "archived" }) => ({
      followup: {
        id: input.id,
        personId: "person-1",
        ownerUserId: OWNER,
        reason: input.reason,
        dueAt: new Date("2026-07-25T15:00:00.000Z"),
        status: input.status,
        cadence: null,
        sourceRecordId: "source-followup",
        lastPromptedAt: null,
        householdId: null,
        scope: "private" as const,
        createdByUserId: OWNER,
        lastActorUserId: OWNER,
        createdAt: now,
        updatedAt: now,
      },
      person: { id: "person-1", displayName: "Priya" },
    });
    const recall = createGlobalRecall({
      ...emptyDependencies,
      listFollowups: async () => [
        followup({
          id: "followup-open",
          reason: "Call about the refrigerator filter",
          status: "open",
        }),
        followup({ id: "followup-old", reason: "Call about the old filter", status: "archived" }),
        followup({ id: "followup-unrelated", reason: "Book dentist", status: "open" }),
      ],
    });

    const active = await recall.search({ ownerUserId: OWNER, query: "Priya filter" });
    const withHistory = await recall.search({
      ownerUserId: OWNER,
      query: "Priya filter",
      includeArchived: true,
    });

    expect(active.results.map((entry) => entry.canonical.id)).toEqual(["followup-open"]);
    expect(active.results[0]?.href).toBe("/people/person-1#followup-followup-open");
    expect(withHistory.results.map((entry) => entry.canonical.id)).toEqual([
      "followup-open",
      "followup-old",
    ]);
  });

  it("returns matching available Calendar events with explicit provider freshness", async () => {
    const fetchedAt = new Date("2026-07-21T12:00:00.000Z");
    const recall = createGlobalRecall({
      ...emptyDependencies,
      readCalendar: async () => ({
        connected: true,
        result: {
          events: [
            {
              providerEventId: "event-filter",
              calendarId: "primary",
              title: "Filter installation meeting",
              start: new Date("2026-07-23T15:00:00.000Z"),
              end: new Date("2026-07-23T15:30:00.000Z"),
              allDay: false,
              status: "confirmed" as const,
              attendees: [],
              location: "Kitchen",
              description: "Install the refrigerator filter",
              updatedAt: fetchedAt,
            },
            {
              providerEventId: "event-unrelated",
              calendarId: "primary",
              title: "Dentist",
              start: new Date("2026-07-24T15:00:00.000Z"),
              end: new Date("2026-07-24T15:30:00.000Z"),
              allDay: false,
              status: "confirmed" as const,
              attendees: [],
              location: null,
              description: null,
              updatedAt: fetchedAt,
            },
          ],
          source: "live" as const,
          stale: false,
          fetchedAt,
          expiresAt: new Date("2026-07-21T12:05:00.000Z"),
        },
      }),
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "filter meeting" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      family: "calendar_event",
      canonical: { kind: "calendar_event", id: "primary:event-filter" },
      trust: "provider_context",
      href: "/account?calendarId=primary&calendarEvent=event-filter&calendarStart=2026-07-23T15%3A00%3A00.000Z&calendarQuery=Filter+installation+meeting#calendar-event-primary%3Aevent-filter",
      details: {
        start: "2026-07-23T15:00:00.000Z",
        source: "live",
        stale: false,
        fetchedAt: "2026-07-21T12:00:00.000Z",
      },
    });
  });

  it("keeps unaffected families usable without substituting Related results when Exact fails", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => {
        throw new Error("exact relationship unavailable");
      },
      searchRelationshipRelated: async () => [
        {
          recordKind: "memory" as const,
          recordId: "memory-weaker",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Priya",
          snippet: "Possibly related filter context",
          similarity: 0.9,
          trustLevel: "confirmed_fact" as const,
          sensitivity: "normal" as const,
          sourceRefs: [{ kind: "memory" as const, id: "memory-weaker" }],
          routing: {
            personId: "person-1",
            recordKind: "memory" as const,
            recordId: "memory-weaker",
          },
          generalAction: null,
        },
      ],
      searchAssets: async () =>
        assetOutcome([
          {
            recordKind: "asset" as const,
            recordId: "asset-1",
            assetId: "asset-1",
            assetName: "Refrigerator filter",
            assetKind: "item" as const,
            assetStatus: "active" as const,
            ownership: "member_owned" as const,
            label: "Refrigerator filter",
            snippet: "Refrigerator filter",
            matchedFields: ["name"],
            value: null,
            trustLevel: "asset_anchor" as const,
            visibilityChoice: "only_me" as const,
            visibilityLabel: "Only me",
            citations: [{ kind: "asset" as const, id: "asset-1" }],
            matchKinds: ["exact" as const],
            score: 0.9,
          },
        ]),
      searchSavedItemsExact: async () => {
        throw new Error("saved item exact unavailable");
      },
      searchSavedItemsRelated: async () => [
        {
          savedItemId: "saved-weaker",
          title: "Related filter note",
          snippet: "Related filter note",
          similarity: 0.9,
          status: "active" as const,
          scope: "private" as const,
        },
      ],
      listFollowups: async () => {
        throw new Error("follow-ups unavailable");
      },
      readCalendar: async () => {
        throw new Error("calendar unavailable");
      },
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["asset-1"]);
    expect(result.limitations.map((limitation) => limitation.source)).toEqual([
      "relationship",
      "saved_items",
      "follow_ups",
      "calendar",
    ]);
  });

  it("applies the primary family filter before retrieval without leaking other source failures", async () => {
    const forbidden = async () => {
      throw new Error("unrequested source must not run");
    };
    const recall = createGlobalRecall({
      searchSelfContextExact: forbidden,
      searchHouseholdContextExact: forbidden,
      searchRelationshipExact: forbidden,
      searchRelationshipRelated: forbidden,
      searchGiftPlans: forbidden,
      searchAssets: async () =>
        assetOutcome([
          {
            recordKind: "asset" as const,
            recordId: "asset-filter",
            assetId: "asset-filter",
            assetName: "Refrigerator filter",
            assetKind: "item" as const,
            assetStatus: "active" as const,
            ownership: "member_owned" as const,
            label: "Refrigerator filter",
            snippet: "Refrigerator filter",
            matchedFields: ["name"],
            value: null,
            trustLevel: "asset_anchor" as const,
            visibilityChoice: "only_me" as const,
            visibilityLabel: "Only me",
            citations: [{ kind: "asset" as const, id: "asset-filter" }],
            matchKinds: ["exact" as const],
            score: 0.9,
          },
        ]),
      searchSavedItemsExact: forbidden,
      searchSavedItemsRelated: forbidden,
      listFollowups: forbidden,
      readCalendar: forbidden,
    });

    const result = await recall.search({
      ownerUserId: OWNER,
      query: "refrigerator filter",
      family: "assets",
    });

    expect(result.results.map((entry) => entry.family)).toEqual(["asset"]);
    expect(result.limitations).toEqual([]);
  });

  it("states when Asset semantic retrieval degraded while preserving exact results", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchAssets: async () =>
        assetOutcome(
          [
            {
              recordKind: "asset" as const,
              recordId: "asset-filter",
              assetId: "asset-filter",
              assetName: "Refrigerator filter",
              assetKind: "item" as const,
              assetStatus: "active" as const,
              ownership: "member_owned" as const,
              label: "Refrigerator filter",
              snippet: "Refrigerator filter",
              matchedFields: ["name"],
              value: null,
              trustLevel: "asset_anchor" as const,
              visibilityChoice: "only_me" as const,
              visibilityLabel: "Only me",
              citations: [{ kind: "asset" as const, id: "asset-filter" }],
              matchKinds: ["exact" as const],
              score: 0.9,
            },
          ],
          false,
        ),
    });

    const result = await recall.search({
      ownerUserId: OWNER,
      query: "refrigerator filter",
      family: "assets",
    });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["asset-filter"]);
    expect(result.limitations).toEqual([
      {
        source: "assets",
        message: "Related Asset matches are unavailable; showing confirmed exact matches only.",
      },
    ]);
  });

  it("omits noise-level Related matches from an answered search without a standing note", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [exactPerson()],
      // Retrieval asks for minimumSimilarity 0, so noise like this rides along on
      // nearly every search. Reporting it would make the note permanent.
      searchRelationshipRelated: async () => [relatedMemory(0.21)],
      searchSavedItemsRelated: async () => [
        {
          savedItemId: "saved-noise",
          title: "Unrelated saved note",
          snippet: "Unrelated saved note",
          similarity: 0.18,
          status: "active" as const,
          scope: "private" as const,
        },
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "priya" });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["person-1"]);
    expect(result.limitations).toEqual([]);
  });

  it("states that a near-miss Related match was withheld from an answered search", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [exactPerson()],
      searchRelationshipRelated: async () => [
        relatedMemory(0.21),
        relatedMemory(0.5, "memory-near"),
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "priya" });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["person-1"]);
    expect(result.limitations).toEqual([
      {
        source: "relationship",
        message: "Some People and context matches were close, but not close enough to show.",
      },
    ]);
  });

  /**
   * The relationship read answers with people, context, and Actions whatever the
   * family filter says, and the filter drops the rest before anything is
   * rendered. So an Action trailing a People-only search was never a People match
   * the floor withheld - saying it was would name a gap the owner did not have.
   */
  it("does not report a near-miss the family filter would have dropped anyway", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [exactPerson()],
      searchRelationshipRelated: async () => [relatedGeneralAction(0.5)],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "priya", family: "people" });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["person-1"]);
    expect(result.limitations).toEqual([]);
  });

  /**
   * A candidate that normalizes to nothing could not have been shown at any
   * similarity, so the floor is not what the owner lost it to.
   */
  it("stays silent about a withheld candidate that could never have been a result", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipRelated: async () => [relatedOrphanSourceRecord(0.2)],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "kayaking" });

    expect(result.results).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it("does not report a near-miss whose record the Exact pass already returned", async () => {
    // Wording a query close to a record's own text scores it as a near miss
    // against itself while Exact already answers with it, so nothing was lost.
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [
        {
          recordKind: "general_action" as const,
          recordId: "action-1",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          label: "Reminder smoke clean",
          snippet: "Reminder smoke clean",
          matchedFields: ["title"],
          rank: 0.9,
          trustLevel: "action_item" as const,
          sensitivity: "normal" as const,
          generalAction: {
            status: "open" as const,
            isRoutine: false,
            isSuggested: false,
            areaId: null,
          },
        },
      ],
      searchRelationshipRelated: async () => [
        {
          ...relatedMemory(0.5, "action-1"),
          recordKind: "general_action" as const,
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          routing: {
            personId: null,
            recordKind: "general_action" as const,
            recordId: "action-1",
          },
          generalAction: {
            status: "open" as const,
            isRoutine: false,
            isSuggested: false,
            areaId: null,
          },
        },
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "clean" });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual(["action-1"]);
    expect(result.limitations).toEqual([]);
  });

  it("attributes a withheld near-miss Saved Item to the Saved Item source", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [exactPerson()],
      searchRelationshipRelated: async () => [relatedMemory(0.21)],
      searchSavedItemsRelated: async () => [
        {
          savedItemId: "saved-near",
          title: "Nearly matching saved note",
          snippet: "Nearly matching saved note",
          similarity: 0.52,
          status: "active" as const,
          scope: "private" as const,
        },
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "priya" });

    expect(result.limitations).toEqual([
      {
        source: "saved_items",
        message: "Some Saved Item matches were close, but not close enough to show.",
      },
    ]);
  });

  it("explains an empty search by what the Related floor withheld", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipRelated: async () => [relatedMemory(0.31)],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });

    expect(result.results).toEqual([]);
    expect(result.limitations).toEqual([
      {
        source: "relationship",
        message: "The nearest records were only loosely related to that search.",
      },
    ]);
  });

  it("stays silent on an empty search that reached nothing to withhold", async () => {
    const recall = createGlobalRecall(emptyDependencies);

    const result = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });

    expect(result.results).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it("keeps one prolific Asset from consuming the first page and reports more results", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [
        {
          recordKind: "general_action" as const,
          recordId: "action-diverse",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          label: "Replace the filter",
          snippet: "Replace the filter",
          matchedFields: ["title"],
          rank: 0.9,
          trustLevel: "action_item" as const,
          sensitivity: "normal" as const,
          generalAction: {
            status: "open" as const,
            isRoutine: false,
            isSuggested: false,
            areaId: null,
          },
        },
      ],
      searchAssets: async () =>
        assetOutcome(
          Array.from({ length: 5 }, (_, index) => ({
            recordKind: "asset_memory" as const,
            recordId: `asset-memory-${index + 1}`,
            assetId: "asset-prolific",
            assetName: "Kitchen refrigerator",
            assetKind: "appliance" as const,
            assetStatus: "active" as const,
            ownership: "member_owned" as const,
            label: `Filter detail ${index + 1}`,
            snippet: `Filter detail ${index + 1}`,
            matchedFields: ["label"],
            value: { type: "text" as const, text: `detail-${index + 1}` },
            trustLevel: "asset_fact" as const,
            visibilityChoice: "only_me" as const,
            visibilityLabel: "Only me",
            citations: [
              { kind: "asset_memory" as const, id: `asset-memory-${index + 1}` },
              { kind: "asset" as const, id: "asset-prolific" },
            ],
            matchKinds: ["exact" as const],
            score: 0.85 - index * 0.01,
          })),
        ),
      searchSavedItemsExact: async () => [
        {
          id: "saved-diverse",
          ownerUserId: OWNER,
          ownership: "member_owned" as const,
          version: 1,
          kind: "note" as const,
          title: "Filter measurements",
          content: "Measure the filter opening",
          url: null,
          status: "active" as const,
          bringBackAt: null,
          bringBackTimeSemantics: "date_only" as const,
          sourceRecordId: "source-saved",
          scope: "private" as const,
          householdId: null,
          resolvedAt: null,
          resolutionReason: null,
          createdByUserId: OWNER,
          lastActorUserId: OWNER,
          createdAt: now,
          updatedAt: now,
          sharedWithUserIds: [],
          householdName: null,
          outcomes: [],
        },
      ],
    });

    const result = await recall.search({
      ownerUserId: OWNER,
      query: "filter",
      limit: 4,
    });

    expect(result.results.map((entry) => entry.canonical.id)).toEqual([
      "action-diverse",
      "asset-memory-1",
      "asset-memory-2",
      "saved-diverse",
    ]);
    expect(result.hasMore).toBe(true);
  });

  it("preserves the adapter's ranking, keeping a named person ahead of the memory naming them", async () => {
    // The ranks are the ones Postgres produces for the query "dana" against a person whose
    // name matches and a memory whose content mentions them: recall re-buckets by match kind
    // and never re-scores, so the identity the query named stays the first thing read.
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: async () => [
        {
          recordKind: "person" as const,
          recordId: "person-dana",
          visibilityChoice: null,
          visibilityLabel: null,
          relatedPersonId: "person-dana",
          relatedPersonDisplayName: "Dana Kim",
          label: "Dana Kim",
          snippet: "Mentor contact for operations questions",
          matchedFields: ["displayName"],
          rank: 0.4018,
          trustLevel: "identity_reference" as const,
          sensitivity: "normal" as const,
          generalAction: null,
        },
        {
          recordKind: "memory" as const,
          recordId: "memory-dana-preference",
          visibilityChoice: "selected_members" as const,
          visibilityLabel: "Specific people",
          relatedPersonId: "person-dana",
          relatedPersonDisplayName: "Dana Kim",
          label: "Dana Kim",
          snippet: "Dana prefers email over chat for professional follow-ups.",
          matchedFields: ["content"],
          rank: 0.1318,
          trustLevel: "confirmed_fact" as const,
          sensitivity: "normal" as const,
          generalAction: null,
        },
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "dana" });

    expect(result.results.map((entry) => entry.canonical)).toEqual([
      { kind: "person", id: "person-dana" },
      { kind: "memory", id: "memory-dana-preference" },
    ]);
    expect(result.results[1]?.family).toBe("relationship_context");
    expect(result.results[1]?.visibility).toEqual({
      choice: "selected_members",
      label: "Specific people",
    });
  });
});

/**
 * The three searches a person actually types, answered through the same stored relationship
 * context the product reads: a name, a phrase from a memory's own wording, and a word that
 * appears in a memory the owner captured by hand. Wiring the real exact-recall queries in
 * (as `createDefaultGlobalRecall` does) is the point - each of these once came back wrong,
 * and none of the faults were visible from the merge alone.
 */
describe("Global Recall over stored relationship context", () => {
  const now = new Date("2026-06-24T12:00:00.000Z");
  const householdId = "9f9908d9-dbfb-48be-bd0b-809ba364d6e3";
  const danaId = "32b13a75-4a4d-44c4-8f7b-a7953af6b961";
  const jordanId = "d1367b4f-79fd-49fd-a3a7-a2807b15a47c";
  const danaMemoryId = "df6e3fc9-2246-4a21-a6be-d361a7113a1b";
  const danaNoteId = "96981b64-6a90-4f63-b2d1-d67e28d52a39";
  const jordanMemoryId = "4efb0d8f-dd33-477a-9b32-6772f983e6df";
  const jordanNoteId = "f41ecf1f-c9d8-4c00-9322-7ee9cc493362";

  const people: Person[] = [
    {
      id: danaId,
      ownerUserId: OWNER,
      displayName: "Dana Kim",
      firstName: "Dana",
      lastName: "Kim",
      birthday: null,
      relationshipType: "colleague",
      closenessLevel: 2,
      profileBlurb: "Mentor contact for operations questions; prefers email over chat.",
      source: "contact_import",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: jordanId,
      ownerUserId: OWNER,
      displayName: "Jordan Rivera",
      firstName: "Jordan",
      lastName: "Rivera",
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 4,
      profileBlurb: null,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const memories: Memory[] = [
    {
      id: danaMemoryId,
      personId: danaId,
      ownerUserId: OWNER,
      householdId,
      sourceRecordId: danaNoteId,
      memoryType: "preference",
      content: "Dana prefers email over chat for professional follow-ups.",
      status: "approved",
      importance: 3,
      sensitivity: "normal",
      confidence: "medium",
      scope: "shared",
      approvedAt: now,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: jordanMemoryId,
      personId: jordanId,
      ownerUserId: OWNER,
      householdId: null,
      sourceRecordId: jordanNoteId,
      memoryType: "preference",
      content: "Jordan Rivera prefers morning coffee chats",
      status: "approved",
      importance: 3,
      sensitivity: "normal",
      confidence: "medium",
      scope: "private",
      approvedAt: now,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const sourceRecords: SourceRecord[] = [
    {
      id: danaNoteId,
      ownerUserId: OWNER,
      sourceType: "contact_import",
      content: "Imported contact note says Dana prefers email and is based in Portland.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "shared",
      householdId,
      importance: 2,
      metadataJson: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      // What explicit memory capture writes: the memory's own receipt, word for word.
      id: jordanNoteId,
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Jordan Rivera prefers morning coffee chats",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      householdId: null,
      importance: 3,
      metadataJson: { capturedVia: "explicit_memory" },
      createdAt: now,
      updatedAt: now,
    },
  ];

  const householdMemberships: HouseholdMembership[] = [
    {
      id: "36c6bb55-3376-485d-bf6d-6d5332826127",
      householdId,
      userId: OWNER,
      invitedByUserId: OWNER,
      role: "owner",
      status: "active",
      invitedAt: now,
      acceptedAt: now,
      removedAt: null,
      pendingRole: null,
      pendingRoleOfferedByUserId: null,
      pendingRoleOfferedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  function storedRecall() {
    const relationshipSearch = createRelationshipContextSearchQueries(
      createInMemoryRelationshipContextSearchStore({
        people,
        memories,
        sourceRecords,
        sourceRecordPeople: [
          {
            id: "3b1c9f0e-1f28-4a1e-9c2c-2f6d0e5a71b1",
            sourceRecordId: danaNoteId,
            personId: danaId,
            role: "primary",
            createdAt: now,
          },
          {
            id: "6f0f3c58-9f6a-4a3c-9a5a-1f9a0f7c3d22",
            sourceRecordId: jordanNoteId,
            personId: jordanId,
            role: "primary",
            createdAt: now,
          },
        ],
        householdMemberships,
      }),
    );

    return createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipExact: (input) =>
        relationshipSearch.searchRelationshipContext({ ...input, includeReviewGated: false }),
    });
  }

  it("answers a person's name with the person and the memory that names them", async () => {
    const result = await storedRecall().search({ ownerUserId: OWNER, query: "dana" });

    expect(result.results.map((entry) => entry.canonical)).toEqual(
      expect.arrayContaining([
        { kind: "person", id: danaId },
        { kind: "memory", id: danaMemoryId },
      ]),
    );
  });

  it("answers a phrase from a memory's own wording with that memory", async () => {
    const result = await storedRecall().search({ ownerUserId: OWNER, query: "prefers email" });

    expect(result.results.map((entry) => entry.canonical)).toContainEqual({
      kind: "memory",
      id: danaMemoryId,
    });
  });

  it("states a captured memory once, never beside the provenance note repeating it", async () => {
    const result = await storedRecall().search({ ownerUserId: OWNER, query: "coffee" });

    expect(
      result.results.map((entry) => ({ canonical: entry.canonical, text: entry.supportingText })),
    ).toEqual([
      {
        canonical: { kind: "memory", id: jordanMemoryId },
        text: "Jordan Rivera prefers morning coffee chats",
      },
    ]);
  });

  it("never answers with the same canonical record twice", async () => {
    for (const query of ["dana", "prefers email", "coffee", "prefers"]) {
      const result = await storedRecall().search({ ownerUserId: OWNER, query });
      const canonicalKeys = result.results.map(
        (entry) => `${entry.canonical.kind}:${entry.canonical.id}`,
      );

      expect(canonicalKeys).toEqual([...new Set(canonicalKeys)]);
    }
  });
});
