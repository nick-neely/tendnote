import {
  searchAssetsSchema,
  searchRelationshipContextSchema,
  searchSavedItemsSemanticSchema,
  searchSemanticContextSchema,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createGlobalRecall } from "./queries";
import type { GlobalRecallDependencies } from "./types";

const OWNER = "owner-1";

function assetOutcome(
  results: Awaited<ReturnType<GlobalRecallDependencies["searchAssets"]>>["results"],
  semanticAvailable = true,
) {
  return { results, semanticAvailable };
}

const emptyDependencies = {
  searchRelationshipExact: async () => [],
  searchRelationshipRelated: async () => [],
  searchAssets: async () => assetOutcome([]),
  searchSavedItemsExact: async () => [],
  searchSavedItemsRelated: async () => [],
  listFollowups: async () => [],
  readCalendar: async () => ({ connected: false, result: null }),
} satisfies GlobalRecallDependencies;

describe("Global Recall", () => {
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
    ).rejects.toThrow("Choose one record family");

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
      searchRelationshipExact: forbidden,
      searchRelationshipRelated: forbidden,
      searchAssets: async () =>
        assetOutcome([
          {
            recordKind: "asset" as const,
            recordId: "asset-filter",
            assetId: "asset-filter",
            assetName: "Refrigerator filter",
            assetKind: "item" as const,
            assetStatus: "active" as const,
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

  it("omits weak Related matches and states the semantic limitation", async () => {
    const recall = createGlobalRecall({
      ...emptyDependencies,
      searchRelationshipRelated: async () => [
        {
          recordKind: "memory" as const,
          recordId: "memory-weak",
          visibilityChoice: "only_me" as const,
          visibilityLabel: "Only me",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Priya",
          snippet: "A weakly related detail",
          similarity: 0.31,
          trustLevel: "confirmed_fact" as const,
          sensitivity: "normal" as const,
          sourceRefs: [{ kind: "memory" as const, id: "memory-weak" }],
          routing: {
            personId: "person-1",
            recordKind: "memory" as const,
            recordId: "memory-weak",
          },
          generalAction: null,
        },
      ],
    });

    const result = await recall.search({ ownerUserId: OWNER, query: "refrigerator filter" });

    expect(result.results).toEqual([]);
    expect(result.limitations).toContainEqual({
      source: "relationship",
      message: "Related relationship matches were too weak to show confidently.",
    });
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
});
