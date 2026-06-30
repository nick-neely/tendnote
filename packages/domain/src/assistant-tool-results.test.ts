import { describe, expect, it } from "vitest";
import {
  assistantToolResultSchemas,
  isRenderedToolName,
  RENDERED_TOOL_NAMES,
} from "./assistant-tool-results";

describe("assistant tool-result contract", () => {
  it("registers a schema for every rendered tool name", () => {
    expect(RENDERED_TOOL_NAMES.length).toBeGreaterThan(0);
    for (const toolName of RENDERED_TOOL_NAMES) {
      expect(assistantToolResultSchemas[toolName]).toBeDefined();
      expect(isRenderedToolName(toolName)).toBe(true);
    }
  });

  it("does not treat an active-only or unknown tool as rendered", () => {
    // search_people shows a shimmer but persists no rendered result.
    expect(isRenderedToolName("search_people")).toBe(false);
    expect(isRenderedToolName("not_a_tool")).toBe(false);
  });

  it("accepts a well-formed capture_source_record result and rejects a malformed one", () => {
    const schema = assistantToolResultSchemas.capture_source_record;
    expect(
      schema.safeParse({ sourceRecord: { id: "s1", content: "Coffee with Maya" } }).success,
    ).toBe(true);
    // Missing the required content field is a contract violation (renders generic).
    expect(schema.safeParse({ sourceRecord: { id: "s1" } }).success).toBe(false);
  });

  it("strips unknown keys so only the minimized contract crosses the seam", () => {
    const schema = assistantToolResultSchemas.search_semantic_context;
    const parsed = schema.safeParse({
      results: [
        {
          recordKind: "source_record",
          recordId: "sr1",
          snippet: "A possible career change.",
          similarity: 0.9,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
          generatedAnswer: "Do not render this.",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed.data)).not.toContain("generatedAnswer");
  });

  it("accepts a relationship-agenda result with candidates and an optional window", () => {
    const parsed = assistantToolResultSchemas.get_relationship_agenda.safeParse({
      candidates: [
        {
          kind: "due_followup",
          title: "Check in with Maya",
          reason: "Reminder due",
          sourceRefs: [{ kind: "followup", id: "f1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          rank: 1,
        },
      ],
      window: { start: "2026-06-30", end: "2026-07-07" },
    });
    expect(parsed.success).toBe(true);
  });
});
