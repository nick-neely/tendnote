import { describe, expect, it } from "vitest";
import { z } from "zod";
import searchAssetsTool from "../agent/tools/search_assets";
import searchGlobalRecallTool from "../agent/tools/search_global_recall";
import searchRelationshipContextTool from "../agent/tools/search_relationship_context";
import searchSemanticContextTool from "../agent/tools/search_semantic_context";

/**
 * The four search tools carry the longest descriptions in the tool set and, until
 * now, not one field-level `.describe()` between them - because their schemas live
 * in `@tendnote/domain`, shared with the web surfaces, where a describe reads as
 * decoration rather than as the model's only instruction for a field.
 *
 * It is not decoration. `toolInputSchema.description` is what eve puts in front of
 * the model per argument, so an undescribed field is a field the model fills from
 * its name alone. Two of them decide what the user sees: `directlyRequested` is the
 * unlock for restricted-sensitivity records, and `minimumSimilarity` silently turns
 * "your notes did not clear my threshold" into "you have no such context".
 *
 * These assert the artifact eve actually hands the provider, not the zod object, so
 * a schema refactor that loses the metadata on the way out fails here.
 */
function modelFacingSchema(tool: { inputSchema: unknown }) {
  return z.toJSONSchema(tool.inputSchema as z.ZodType, { io: "input" }) as {
    type?: string;
    oneOf?: unknown;
    anyOf?: unknown;
    properties: Record<string, { description?: string } | undefined>;
  };
}

const SEARCH_TOOLS = [
  ["search_global_recall", searchGlobalRecallTool],
  ["search_relationship_context", searchRelationshipContextTool],
  ["search_semantic_context", searchSemanticContextTool],
  ["search_assets", searchAssetsTool],
] as const;

describe("search tool input schemas are described for the model", () => {
  it.each(SEARCH_TOOLS)("%s describes every field it offers", (_name, tool) => {
    const { properties } = modelFacingSchema(tool);

    expect(Object.keys(properties).length).toBeGreaterThan(0);
    for (const [field, definition] of Object.entries(properties)) {
      expect(definition?.description, field).toBeTruthy();
    }
  });

  it.each(SEARCH_TOOLS)("%s stays a plain object schema the provider accepts", (_name, tool) => {
    // The conditional constraints are refinements over an object, never a top-level
    // union: zod renders a union as a root `oneOf` with no `"type": "object"`, which
    // is not a tool input schema the Messages API takes.
    const json = modelFacingSchema(tool);

    expect(json.type).toBe("object");
    expect(json.oneOf).toBeUndefined();
    expect(json.anyOf).toBeUndefined();
  });

  it.each([
    ["search_relationship_context", searchRelationshipContextTool],
    ["search_semantic_context", searchSemanticContextTool],
  ] as const)("%s tells the model what directlyRequested unlocks", (_name, tool) => {
    const description = modelFacingSchema(tool).properties.directlyRequested?.description ?? "";

    // The restricted unlock. Named for a caller-side policy question, it reads like a
    // provenance flag - "the user asked for this" - which is exactly the sentence a
    // model would set to true on any direct question.
    expect(description).toMatch(/restricted/i);
    expect(description).toMatch(/only when the user explicitly asked/i);
    expect(description).toMatch(/never speculatively/i);
  });

  it("search_semantic_context warns that a similarity floor manufactures an empty answer", () => {
    const description =
      modelFacingSchema(searchSemanticContextTool).properties.minimumSimilarity?.description ?? "";

    expect(description).toMatch(/leave at 0/i);
    expect(description).toMatch(/no such context/i);
  });

  it("keeps the owner-only review flag off the model's schema entirely", () => {
    // Not described, because it is not offered: a review-gated flag is a caller
    // decision the tools pin to false after spreading input (ADRs 0151-0153).
    for (const [name, tool] of SEARCH_TOOLS) {
      expect(Object.keys(modelFacingSchema(tool).properties), name).not.toContain(
        "includeReviewGated",
      );
    }
  });

  it("requires an explicit visibility boundary for exact relationship recall", () => {
    const schema = modelFacingSchema(searchRelationshipContextTool) as {
      required?: string[];
      properties: Record<string, unknown>;
    };

    expect(schema.properties).toHaveProperty("visibilityScope");
    expect(schema.required).toContain("visibilityScope");
  });
});
