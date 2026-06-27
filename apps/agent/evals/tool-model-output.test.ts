import { describe, expect, it } from "vitest";
import agendaTool from "../agent/tools/get_relationship_agenda";
import exactSearchTool from "../agent/tools/search_relationship_context";
import semanticSearchTool from "../agent/tools/search_semantic_context";

/**
 * `toModelOutput` shapes what the *model* sees; channels (the web chat) still
 * receive the full structured `execute` output for rich rendering. These checks
 * pin that contract: the model view drops the record/person UUIDs the agent is
 * told never to surface, while keeping the names, kinds, reasons, and trust it
 * needs to write a reply.
 */

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE_ID = "22222222-2222-2222-2222-222222222222";

type ModelOut = { type: string; value: unknown };

/** Calls a tool's (synchronous) toModelOutput with a sample, casting the strict
 *  param/return types away so the sample stays readable in the test. */
function modelOutput(fn: ((output: never) => unknown) | undefined, output: unknown): ModelOut {
  if (!fn) throw new Error("tool has no toModelOutput");
  return (fn as (o: unknown) => ModelOut)(output);
}

describe("get_relationship_agenda toModelOutput", () => {
  const rawOutput = {
    candidates: [
      {
        kind: "review_item" as const,
        personId: PERSON_ID,
        personDisplayName: "Priya Shah",
        title: "Review suggested memory for Priya Shah",
        reason: "Priya may need a revised launch checklist by Monday.",
        dueAt: undefined,
        sourceRefs: [{ kind: "source_record" as const, id: SOURCE_ID }],
        trustLevel: "tentative" as const,
        sensitivity: "normal" as const,
        rank: 1,
      },
    ],
    window: { start: "2026-06-27", end: "2026-06-30" },
    component: { type: "relationship_agenda", resultCount: 1 },
  };

  it("keeps name, kind, reason, and trust but strips ids, sourceRefs, and rank", () => {
    const model = modelOutput(agendaTool.toModelOutput, rawOutput);
    expect(model.type).toBe("json");
    const serialized = JSON.stringify(model.value);

    expect(serialized).toContain("Priya Shah");
    expect(serialized).toContain("review_item");
    expect(serialized).toContain("revised launch checklist");
    expect(serialized).toContain("tentative");

    // Ids and render scaffolding never reach the model.
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain(SOURCE_ID);
    expect(serialized).not.toContain("sourceRefs");
    expect(serialized).not.toContain("rank");
  });

  it("does not mutate the raw output the channel renders", () => {
    agendaTool.toModelOutput?.(rawOutput);
    // The full payload (ids, sourceRefs, component) is intact for the UI parser.
    expect(rawOutput.candidates[0]?.personId).toBe(PERSON_ID);
    expect(rawOutput.candidates[0]?.sourceRefs[0]?.id).toBe(SOURCE_ID);
    expect(rawOutput.component.type).toBe("relationship_agenda");
  });
});

describe("search tools toModelOutput strip record ids", () => {
  it("exact recall drops record/person ids from the model view", () => {
    const model = modelOutput(exactSearchTool.toModelOutput, {
      results: [
        {
          recordKind: "memory",
          recordId: SOURCE_ID,
          relatedPersonId: PERSON_ID,
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Prefers backend architecture conversations.",
          matchedFields: ["content"],
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
        },
      ],
      component: { type: "relationship_context_search", resultCount: 1 },
    });
    const serialized = JSON.stringify(model.value);
    expect(serialized).toContain("Mara Lin");
    expect(serialized).toContain("backend architecture");
    expect(serialized).not.toContain(SOURCE_ID);
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain("matchedFields");
  });

  it("semantic recall drops record/person ids from the model view", () => {
    const model = modelOutput(semanticSearchTool.toModelOutput, {
      results: [
        {
          recordKind: "source_record",
          recordId: SOURCE_ID,
          relatedPersonId: PERSON_ID,
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Mentioned a possible career change.",
          similarity: 0.88,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
        },
      ],
      component: { type: "semantic_context_search", resultCount: 1 },
    });
    const serialized = JSON.stringify(model.value);
    expect(serialized).toContain("Mara Lin");
    expect(serialized).toContain("career change");
    expect(serialized).not.toContain(SOURCE_ID);
    expect(serialized).not.toContain(PERSON_ID);
  });
});
