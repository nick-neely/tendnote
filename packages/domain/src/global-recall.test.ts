import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type GlobalRecallResult,
  globalRecallCanonicalKindSchema,
  globalRecallInputSchema,
  globalRecallResponseSchema,
  globalRecallToolInputSchema,
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

/** The model-facing artifact: what eve actually hands the provider for this tool. */
function toolSchemaProperties() {
  return z.toJSONSchema(globalRecallToolInputSchema, { io: "input" }) as {
    properties: Record<string, { description?: string } | undefined>;
  };
}

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
      {
        ...base,
        label: "I run a software consultancy.",
        supportingText: "Work",
        family: "self_context",
        canonical: { kind: "context_fact", id: "context-fact-1" },
        grounding: [{ kind: "context_fact", id: "context-fact-1" }],
        trust: "self_context",
        visibility: { choice: "only_me", label: "Only me" },
        href: "/account/about-you#context-fact-context-fact-1",
        details: {
          content: "I run a software consultancy.",
          category: "work",
          categoryLabel: "Work",
          provenance: { channel: "account", origin: "direct" },
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
    ).toHaveLength(9);
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

  /**
   * `family` defaults to "all", so a caller that set `includeRestricted` and left
   * `family` alone was certain to be rejected - by a message that did not name the
   * field to change, from a schema whose fields carried no description at all. For
   * the model-facing copy of this schema that is the whole difference between a
   * rule it can follow and a wall it walks into (T11, T12).
   */
  describe("the restricted unlock explains itself", () => {
    it("names the field to set, and what to do instead", () => {
      const parsed = globalRecallInputSchema.safeParse({
        query: "Priya medical",
        includeRestricted: true,
      });

      expect(parsed.success).toBe(false);
      const [issue] = parsed.error?.issues ?? [];
      expect(issue?.path).toEqual(["family"]);
      expect(issue?.message).toMatch(/set `family` to one specific record family/i);
      expect(issue?.message).toMatch(/drop `includeRestricted`/);
    });

    it("states the rule on both fields it constrains, before any call is made", () => {
      const { properties } = toolSchemaProperties();

      expect(properties.includeRestricted?.description).toMatch(/one record family at a time/);
      expect(properties.includeRestricted?.description).toMatch(
        /only when the user explicitly asks/i,
      );
      expect(properties.family?.description).toMatch(/one record family at a time/);
    });

    it("describes every field the model has to fill", () => {
      const { properties } = toolSchemaProperties();

      for (const field of ["query", "family", "includeArchived", "matchKinds", "limit"]) {
        expect(properties[field]?.description, field).toBeTruthy();
      }
    });

    /**
     * The refinement rides on a plain object rather than a union, so what eve hands
     * the provider stays a `"type": "object"` input schema. A root `oneOf` is not a
     * tool schema the Messages API accepts, and this is the pin on that.
     */
    it("still renders as a plain object schema for the provider", () => {
      const json = z.toJSONSchema(globalRecallToolInputSchema, { io: "input" }) as {
        type?: string;
        oneOf?: unknown;
        anyOf?: unknown;
      };

      expect(json.type).toBe("object");
      expect(json.oneOf).toBeUndefined();
      expect(json.anyOf).toBeUndefined();
    });
  });
});
