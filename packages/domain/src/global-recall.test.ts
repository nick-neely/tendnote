import { describe, expect, it } from "vitest";
import {
  type GlobalRecallResult,
  globalRecallCanonicalKindSchema,
  globalRecallInputSchema,
  globalRecallResponseSchema,
} from "./global-recall";

const base = {
  label: "Result",
  supportingText: "Grounded detail",
  lifecycle: "active",
  match: { kind: "exact" as const, reason: "Matched wording", excerpt: "detail" },
  sensitivity: "normal" as const,
  visibility: null,
  href: "/",
  parent: null,
};

describe("Global Recall contract", () => {
  it("accepts every canonical family in one typed response", () => {
    const results: GlobalRecallResult[] = [
      {
        ...base,
        family: "person",
        canonical: { kind: "person", id: "person-1" },
        grounding: [{ kind: "person", id: "person-1" }],
        trust: "identity_reference",
        details: { displayName: "Priya" },
      },
      {
        ...base,
        family: "relationship_context",
        canonical: { kind: "memory", id: "memory-1" },
        grounding: [{ kind: "source_record", id: "source-1" }],
        trust: "confirmed_fact",
        details: { contextKind: "memory", personDisplayName: "Priya" },
      },
      {
        ...base,
        family: "follow_up",
        canonical: { kind: "follow_up", id: "followup-1" },
        grounding: [{ kind: "follow_up", id: "followup-1" }],
        trust: "follow_up",
        details: { dueAt: "2026-07-25T12:00:00.000Z", cadence: null, personDisplayName: "Priya" },
      },
      {
        ...base,
        family: "general_action",
        canonical: { kind: "general_action", id: "action-1" },
        grounding: [{ kind: "general_action", id: "action-1" }],
        trust: "action_item",
        details: { status: "open", isRoutine: false, isSuggested: false, areaId: null },
      },
      {
        ...base,
        family: "asset",
        canonical: { kind: "asset", id: "asset-1" },
        grounding: [{ kind: "asset_evidence", id: "evidence-1" }],
        trust: "asset_anchor",
        details: { assetKind: "appliance" },
      },
      {
        ...base,
        family: "asset_memory",
        canonical: { kind: "asset_memory", id: "asset-memory-1" },
        grounding: [{ kind: "asset_memory", id: "asset-memory-1" }],
        trust: "asset_fact",
        details: {
          assetId: "asset-1",
          assetName: "Fridge",
          assetKind: "appliance",
          value: { type: "text", text: "RPWFE" },
        },
      },
      {
        ...base,
        family: "saved_item",
        canonical: { kind: "saved_item", id: "saved-1" },
        grounding: [{ kind: "saved_item", id: "saved-1" }],
        trust: "saved_context",
        details: { kind: "note" },
      },
      {
        ...base,
        family: "calendar_event",
        canonical: { kind: "calendar_event", id: "calendar-1" },
        grounding: [{ kind: "calendar_event", id: "calendar-1" }],
        trust: "provider_context",
        details: {
          start: "2026-07-25T12:00:00.000Z",
          end: "2026-07-25T13:00:00.000Z",
          allDay: false,
          status: "confirmed",
          source: "live",
          stale: false,
          fetchedAt: "2026-07-21T12:00:00.000Z",
        },
      },
    ];

    expect(
      globalRecallResponseSchema.parse({
        query: "filter",
        results,
        limitations: [],
        hasMore: false,
      }).results,
    ).toHaveLength(8);
  });

  it("never permits grounding-only records as canonical results", () => {
    expect(globalRecallCanonicalKindSchema.safeParse("source_record").success).toBe(false);
    expect(globalRecallCanonicalKindSchema.safeParse("asset_evidence").success).toBe(false);
  });

  it("rejects tokenless and one-character queries before retrieval", () => {
    expect(globalRecallInputSchema.safeParse({ query: "!!" }).success).toBe(false);
    expect(globalRecallInputSchema.safeParse({ query: "a" }).success).toBe(false);
  });

  it("requires a targeted family before restricted matches can be revealed", () => {
    expect(
      globalRecallInputSchema.safeParse({
        query: "Priya medical",
        family: "all",
        includeRestricted: true,
      }).success,
    ).toBe(false);
    expect(
      globalRecallInputSchema.safeParse({
        query: "Priya medical",
        family: "people",
        includeRestricted: true,
      }).success,
    ).toBe(true);
  });
});
